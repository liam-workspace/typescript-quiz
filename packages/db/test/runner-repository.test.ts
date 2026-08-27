import type pg from "pg"
import { describe, expect, it } from "vitest"
import { loadRunnerEnvelope } from "../src/repositories/runner.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest, type Fixture } from "./helpers/fixtures.js"

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000)
}

async function insertAttempt(pool: pg.Pool, f: Fixture): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO attempt (student_id, test_version_id, status)
     VALUES ($1, $2, 'in_progress') RETURNING id`,
    [f.studentId, f.versionId],
  )
  const [row] = rows

  return row.id
}

async function enterSection(
  pool: pg.Pool,
  input: {
    attemptId: string
    versionId: string
    sectionId: string
    expiresAt: Date
    completedAt?: Date
  },
): Promise<void> {
  if (input.completedAt) {
    // `attempt_section_counts_reconcile` requires the whole score breakdown
    // once completed_at is set; the values themselves are irrelevant to
    // this repository test, so zero-filled correct + incorrect = answered.
    await pool.query(
      `INSERT INTO attempt_section (
         attempt_id, test_section_id, test_version_id, expires_at, completed_at,
         points_earned, points_possible, answered_count, unanswered_count,
         correct_count, incorrect_count
       ) VALUES ($1, $2, $3, $4, $5, 0, 0, 0, 0, 0, 0)`,
      [
        input.attemptId,
        input.sectionId,
        input.versionId,
        input.expiresAt,
        input.completedAt,
      ],
    )

    return
  }

  await pool.query(
    `INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [input.attemptId, input.sectionId, input.versionId, input.expiresAt],
  )
}

async function recordResponse(
  pool: pg.Pool,
  input: {
    attemptId: string
    versionId: string
    questionId: string
    choiceIds: string[]
    clientInstanceId?: string
    seq?: number
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO response (attempt_id, question_id, test_version_id, client_instance_id, client_seq, answered_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [
      input.attemptId,
      input.questionId,
      input.versionId,
      input.clientInstanceId ?? "device-a",
      input.seq ?? 1,
    ],
  )

  await Promise.all(
    input.choiceIds.map((choiceId) =>
      pool.query(
        `INSERT INTO response_choice (attempt_id, question_id, choice_id) VALUES ($1, $2, $3)`,
        [input.attemptId, input.questionId, choiceId],
      ),
    ),
  )
}

function sectionStateOf(
  envelope: Awaited<ReturnType<typeof loadRunnerEnvelope>>,
  sectionId: string,
) {
  const section = envelope.sections.find((s) => s.id === sectionId)

  if (!section) {
    throw new Error(`expected section ${sectionId} to be present`)
  }

  return section
}

describe("loadRunnerEnvelope", () => {
  it("marks every section pending with null completedAt/expiresAt before any section is entered", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, f)

      const envelope = await loadRunnerEnvelope(pool, {
        attemptId,
        testVersionId: f.versionId,
      })

      for (const section of envelope.sections) {
        expect(section.status).toBe("pending")
        expect(section.completedAt).toBeNull()
        expect(section.expiresAt).toBeNull()
      }
    })
  }, 120_000)

  it("marks a section open with the attempt_section's expiresAt once entered", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, f)
      const expiresAt = minutesFromNow(30)
      await enterSection(pool, {
        attemptId,
        versionId: f.versionId,
        sectionId: f.listeningSectionId,
        expiresAt,
      })

      const envelope = await loadRunnerEnvelope(pool, {
        attemptId,
        testVersionId: f.versionId,
      })

      const listening = sectionStateOf(envelope, f.listeningSectionId)

      expect(listening.status).toBe("open")
      expect(listening.completedAt).toBeNull()
      expect(listening.expiresAt).toBe(expiresAt.toISOString())

      const reading = sectionStateOf(envelope, f.readingSectionId)

      expect(reading.status).toBe("pending")
    })
  }, 120_000)

  it("marks a section closed with completedAt once attempt_section.completed_at is set", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, f)
      const expiresAt = minutesFromNow(30)
      const completedAt = minutesFromNow(15)
      await enterSection(pool, {
        attemptId,
        versionId: f.versionId,
        sectionId: f.listeningSectionId,
        expiresAt,
        completedAt,
      })

      const envelope = await loadRunnerEnvelope(pool, {
        attemptId,
        testVersionId: f.versionId,
      })

      const listening = sectionStateOf(envelope, f.listeningSectionId)

      expect(listening.status).toBe("closed")
      expect(listening.completedAt).toBe(completedAt.toISOString())
    })
  }, 120_000)

  it("computes answeredCount and unansweredOrdinals from recorded responses", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, f)
      const [q1] = f.questionIds
      const [c1] = f.choiceIds
      await recordResponse(pool, {
        attemptId,
        versionId: f.versionId,
        questionId: q1,
        choiceIds: [c1],
      })

      const envelope = await loadRunnerEnvelope(pool, {
        attemptId,
        testVersionId: f.versionId,
      })

      expect(envelope.questionCount).toBe(2)
      expect(envelope.answeredCount).toBe(1)
      expect(envelope.unansweredOrdinals).toEqual([2])
    })
  }, 120_000)

  it("aggregates multiple response_choice rows into one selectedChoiceIds array per response", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, f)
      const [q1] = f.questionIds
      const [c1, c2] = f.choiceIds
      await recordResponse(pool, {
        attemptId,
        versionId: f.versionId,
        questionId: q1,
        choiceIds: [c1, c2],
      })

      const envelope = await loadRunnerEnvelope(pool, {
        attemptId,
        testVersionId: f.versionId,
      })

      expect(envelope.responses).toHaveLength(1)
      const [response] = envelope.responses

      expect(response.questionId).toBe(q1)
      expect(response.selectedChoiceIds.sort()).toEqual([c1, c2].sort())
    })
  }, 120_000)

  it("returns an empty responses array when nothing has been recorded", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, f)

      const envelope = await loadRunnerEnvelope(pool, {
        attemptId,
        testVersionId: f.versionId,
      })

      expect(envelope.responses).toEqual([])
    })
  }, 120_000)

  it("never includes isCorrect anywhere in the returned tree", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, f)
      const [q1, q2] = f.questionIds
      const [c1, , c3] = f.choiceIds
      await enterSection(pool, {
        attemptId,
        versionId: f.versionId,
        sectionId: f.listeningSectionId,
        expiresAt: minutesFromNow(30),
      })
      // `c1` and `c3` are the fixture's known-correct choices for q1 and
      // q2 -- recording them is what would leak the answer key if the
      // projection ever started echoing which choice was selected as
      // `isCorrect: true`.
      await recordResponse(pool, {
        attemptId,
        versionId: f.versionId,
        questionId: q1,
        choiceIds: [c1],
      })
      await recordResponse(pool, {
        attemptId,
        versionId: f.versionId,
        questionId: q2,
        choiceIds: [c3],
        clientInstanceId: "device-b",
      })

      const envelope = await loadRunnerEnvelope(pool, {
        attemptId,
        testVersionId: f.versionId,
      })
      const serialized = JSON.stringify(envelope)

      expect(serialized).not.toContain("isCorrect")
      expect(serialized).not.toContain("is_correct")
    })
  }, 120_000)
})
