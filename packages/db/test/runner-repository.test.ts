import { randomUUID } from "node:crypto"
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
  it("projects the authoritative attempt number, test title, and section-intro metadata", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)

      const envelope = await loadRunnerEnvelope(pool, {
        attemptId,
        testVersionId: fixture.versionId,
      })

      expect(envelope.attemptNumber).toBe(1)
      expect(envelope.testTitle).toBe("TOEFL Primary — Practice Test 04")
      expect(
        sectionStateOf(envelope, fixture.listeningSectionId),
      ).toMatchObject({
        title: "Listening — Part 1",
        questionCount: 1,
        durationSeconds: 1500,
        instructions: ["Put your headphones on now."],
      })
      expect(sectionStateOf(envelope, fixture.readingSectionId)).toMatchObject({
        title: "Reading",
        questionCount: 1,
        durationSeconds: 1500,
        instructions: [],
      })
    })
  }, 120_000)

  // The shared fixture gives each section ONE question and one instruction,
  // so 1 x 1 = 1 and a fan-out is invisible. This seeds its own version with
  // three instructions and three questions in one section: joined and
  // aggregated that yields nine entries, and the rules screen rendered each
  // instruction three times -- twenty times against real content. Found in
  // the browser pass, not here.
  //
  // Self-contained because content must be written BEFORE publication; the
  // immutability trigger refuses inserts once published_at is set, so this
  // cannot be appended to the shared already-published fixture.
  it("returns each instruction once for a section with many questions", async () => {
    await withDatabase(async (pool) => {
      const studentId = "11111111-1111-1111-1111-111111111113"
      const testId = "22222222-2222-2222-2222-222222222224"
      const versionId = "a0000000-0000-0000-0000-000000000003"
      const sectionId = "b0000000-0000-0000-0000-000000000004"
      const groupId = "c0000000-0000-0000-0000-000000000004"

      await pool.query(
        `INSERT INTO student (id, subject_claim, email, display_name)
         VALUES ($1,'sub-fanout','fanout@example.test','Fanout')`,
        [studentId],
      )
      await pool.query(`INSERT INTO test (id, slug) VALUES ($1,'fanout')`, [
        testId,
      ])
      await pool.query(
        `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
         VALUES ($1,$2,1,'Fan-out check',600)`,
        [versionId, testId],
      )
      await pool.query(
        `INSERT INTO test_section (id, test_version_id, ordinal, title, type,
                                   duration_seconds, navigation, allow_answer_change)
         VALUES ($1,$2,1,'Listening','listening',600,'free',true)`,
        [sectionId, versionId],
      )
      await pool.query(
        `INSERT INTO section_instruction (test_section_id, ordinal, text)
         VALUES ($1,1,'First.'), ($1,2,'Second.'), ($1,3,'Third.')`,
        [sectionId],
      )
      await pool.query(
        `INSERT INTO question_group (id, test_version_id, test_section_id, ordinal)
         VALUES ($1,$2,$3,1)`,
        [groupId, versionId, sectionId],
      )

      const questionIds = [randomUUID(), randomUUID(), randomUUID()]

      // One statement each rather than a loop of awaits: three questions in
      // ONE section is the whole point of this fixture, and the fan-out it
      // exposes does not care how the rows got there.
      await pool.query(
        `INSERT INTO question (id, test_version_id, question_group_id,
                               question_key, ordinal, prompt, type, points)
         VALUES ($1,$4,$5,'qa',1,'A prompt?','single_choice',1),
                ($2,$4,$5,'qb',2,'A prompt?','single_choice',1),
                ($3,$4,$5,'qc',3,'A prompt?','single_choice',1)`,
        [...questionIds, versionId, groupId],
      )
      await pool.query(
        `INSERT INTO choice (id, question_id, ordinal, label, is_correct)
         SELECT gen_random_uuid(), q, o.ordinal, o.label, o.is_correct
           FROM unnest($1::uuid[]) AS q,
                (VALUES (1,'Yes',true),(2,'No',false))
                  AS o(ordinal, label, is_correct)`,
        [questionIds],
      )

      await pool.query(
        `UPDATE test_version SET published_at = now() WHERE id = $1`,
        [versionId],
      )
      await pool.query(
        `UPDATE test SET current_version_id = $1 WHERE id = $2`,
        [versionId, testId],
      )

      const attemptId = randomUUID()
      const startedAt = new Date()

      await pool.query(
        `INSERT INTO attempt (id, student_id, test_version_id, status,
                              started_at, expires_at)
         VALUES ($1,$2,$3,'in_progress',$4,$5)`,
        [
          attemptId,
          studentId,
          versionId,
          startedAt,
          new Date(startedAt.getTime() + 600_000),
        ],
      )

      const envelope = await loadRunnerEnvelope(pool, {
        attemptId,
        testVersionId: versionId,
      })

      expect(sectionStateOf(envelope, sectionId)).toMatchObject({
        questionCount: 3,
        instructions: ["First.", "Second.", "Third."],
      })
    })
  }, 120_000)

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
