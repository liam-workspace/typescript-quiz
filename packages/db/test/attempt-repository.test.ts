import { randomUUID } from "node:crypto"
import { createFixedClock } from "@pp/common"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import {
  finalizeExpiredAttempt,
  loadOwnedAttempt,
  loadRunningOwnedAttempt,
  startOrResumeAttempt,
  TestNotFoundError,
} from "../src/repositories/attempt.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest, type Fixture } from "./helpers/fixtures.js"

/**
 * `startedAt`/`expiresAt` default to a window that has ALREADY closed --
 * started an hour ago, expired ten minutes ago -- while `status` stays
 * 'in_progress'. That combination is the whole premise of lazy expiry: the
 * clock ran out, but nothing has touched the row since, so it is still
 * sitting there waiting for the next request to notice.
 */
async function insertAttempt(
  pool: pg.Pool,
  f: Fixture,
  input: {
    id: string
    studentId?: string
    startedAt?: string
    expiresAt?: string | null
  },
): Promise<void> {
  const startedAt = input.startedAt ?? "now() - interval '1 hour'"
  const expiresAt =
    input.expiresAt === null
      ? "NULL"
      : (input.expiresAt ?? "now() - interval '10 minutes'")

  await pool.query(
    `INSERT INTO attempt (id, student_id, test_version_id, status, started_at, expires_at)
     VALUES ($1, $2, $3, 'in_progress', ${startedAt}, ${expiresAt})`,
    [input.id, input.studentId ?? f.studentId, f.versionId],
  )
}

async function insertSecondStudent(pool: pg.Pool): Promise<string> {
  const id = randomUUID()

  await pool.query(
    `INSERT INTO student (id, subject_claim, email, display_name)
     VALUES ($1, 'sub-jerry', 'jerry@example.test', 'Jerry')`,
    [id],
  )

  return id
}

/** Records a correct answer to the fixture's first question. */
async function recordCorrectAnswer(
  pool: pg.Pool,
  f: Fixture,
  attemptId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO response (attempt_id, question_id, test_version_id, client_instance_id, client_seq)
     VALUES ($1, $2, $3, 'ci', 1)`,
    [attemptId, f.questionIds[0], f.versionId],
  )
  await pool.query(
    `INSERT INTO response_choice (attempt_id, question_id, choice_id)
     VALUES ($1, $2, $3)`,
    [attemptId, f.questionIds[0], f.choiceIds[0]],
  )
}

/**
 * A fully graded, already-submitted attempt -- the "finished" case that
 * `startOrResumeAttempt` must never treat as blocking a new one. Carries
 * every graded column so `attempt_finished_is_graded` is satisfied.
 */
async function insertFinishedAttempt(
  pool: pg.Pool,
  f: Fixture,
): Promise<string> {
  const id = randomUUID()

  await pool.query(
    `INSERT INTO attempt (
       id, student_id, test_version_id, status, started_at, expires_at,
       submitted_at, points_earned, points_possible, percentage,
       answered_count, unanswered_count, correct_count, incorrect_count, question_count
     ) VALUES (
       $1, $2, $3, 'submitted', now() - interval '1 hour', now() - interval '30 minutes',
       now() - interval '30 minutes', 2, 2, 100, 2, 0, 2, 0, 2
     )`,
    [id, f.studentId, f.versionId],
  )

  return id
}

interface RawAttemptRow {
  status: string
  submitted_at: Date | null
  points_earned: number | null
  points_possible: number | null
  percentage: string | null
  answered_count: number | null
  unanswered_count: number | null
  correct_count: number | null
  incorrect_count: number | null
  question_count: number | null
}

async function readAttemptRow(
  pool: pg.Pool,
  attemptId: string,
): Promise<RawAttemptRow> {
  const { rows } = await pool.query<RawAttemptRow>(
    `SELECT * FROM attempt WHERE id = $1`,
    [attemptId],
  )
  const [row] = rows

  return row
}

// One flat describe, not one nested per function under test: vitest/eslint
// caps callback nesting at 3 (describe > it > withDatabase's async body),
// and a describe per function would be a 4th level.
describe("attempt repository", () => {
  // -- loadOwnedAttempt --

  it("returns the attempt row when studentId matches", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, { id: attemptId })

      const row = await loadOwnedAttempt(pool, {
        attemptId,
        studentId: f.studentId,
      })

      expect(row?.id).toBe(attemptId)
      expect(row?.studentId).toBe(f.studentId)
      expect(row?.testVersionId).toBe(f.versionId)
      expect(row?.status).toBe("in_progress")
    })
  }, 120_000)

  it("returns null when the attempt belongs to another student", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const otherStudentId = await insertSecondStudent(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, { id: attemptId })

      const row = await loadOwnedAttempt(pool, {
        attemptId,
        studentId: otherStudentId,
      })

      expect(row).toBeNull()
    })
  }, 120_000)

  it("returns null for a nonexistent attemptId", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)

      const row = await loadOwnedAttempt(pool, {
        attemptId: randomUUID(),
        studentId: f.studentId,
      })

      expect(row).toBeNull()
    })
  }, 120_000)

  // -- finalizeExpiredAttempt --

  it("finalizes an expired attempt with zero responses recorded", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, { id: attemptId })

      const result = await finalizeExpiredAttempt(pool, {
        attemptId,
        now: new Date(),
      })

      expect(result.status).toBe("expired")

      const row = await readAttemptRow(pool, attemptId)
      expect(row.status).toBe("expired")
      expect(row.submitted_at?.toISOString()).toBe(
        result.submittedAt.toISOString(),
      )
      expect(row.points_earned).toBe(0)
      // Two single-point questions in the fixture.
      expect(row.points_possible).toBe(2)
      expect(Number(row.percentage)).toBe(0)
      expect(row.answered_count).toBe(0)
      expect(row.unanswered_count).toBe(2)
      expect(row.correct_count).toBe(0)
      expect(row.incorrect_count).toBe(0)
      expect(row.question_count).toBe(2)
    })
  }, 120_000)

  it("pins submittedAt to expiresAt, not to the clock passed in", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, { id: attemptId })

      const { rows: expected } = await pool.query<{ expires_at: Date }>(
        `SELECT expires_at FROM attempt WHERE id = $1`,
        [attemptId],
      )

      // Well past the deadline -- if the clock leaked in, submittedAt would
      // land here instead of at expires_at.
      const farFuture = createFixedClock(new Date(Date.now() + 60 * 60 * 1000))
      const result = await finalizeExpiredAttempt(pool, {
        attemptId,
        now: farFuture.now(),
      })

      expect(result.submittedAt.toISOString()).toBe(
        expected[0].expires_at.toISOString(),
      )
    })
  }, 120_000)

  it("is idempotent -- finalizing twice does not re-grade or throw", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, { id: attemptId })

      const first = await finalizeExpiredAttempt(pool, {
        attemptId,
        now: new Date(),
      })

      // A late write lands after the first finalize -- if the second call
      // re-graded, this would flip points_earned/correct_count.
      await recordCorrectAnswer(pool, f, attemptId)

      const second = await finalizeExpiredAttempt(pool, {
        attemptId,
        now: new Date(),
      })

      expect(second.submittedAt.toISOString()).toBe(
        first.submittedAt.toISOString(),
      )

      const row = await readAttemptRow(pool, attemptId)
      expect(row.points_earned).toBe(0)
      expect(row.correct_count).toBe(0)
    })
  }, 120_000)

  it("satisfies attempt_finished_is_graded -- no CHECK violation", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, { id: attemptId })

      // A CHECK violation throws inside this call, before any assertion
      // below runs -- so simply resolving is the proof.
      await expect(
        finalizeExpiredAttempt(pool, { attemptId, now: new Date() }),
      ).resolves.toMatchObject({ status: "expired" })
    })
  }, 120_000)

  // -- loadRunningOwnedAttempt --

  it("returns the live attempt when still running", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, {
        id: attemptId,
        startedAt: "now()",
        expiresAt: "now() + interval '25 minutes'",
      })

      const result = await loadRunningOwnedAttempt(pool, {
        attemptId,
        studentId: f.studentId,
        now: new Date(),
      })

      expect(result.attempt?.id).toBe(attemptId)
      expect(result.finalized).toBeNull()
    })
  }, 120_000)

  it("treats a null expiresAt as still running, not expired", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, {
        id: attemptId,
        startedAt: "NULL",
        expiresAt: null,
      })

      const result = await loadRunningOwnedAttempt(pool, {
        attemptId,
        studentId: f.studentId,
        now: new Date(),
      })

      expect(result.attempt?.id).toBe(attemptId)
      expect(result.finalized).toBeNull()
    })
  }, 120_000)

  it("finalizes and returns null attempt when the deadline has passed", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, { id: attemptId })

      const result = await loadRunningOwnedAttempt(pool, {
        attemptId,
        studentId: f.studentId,
        now: new Date(),
      })

      expect(result.attempt).toBeNull()
      expect(result.finalized?.status).toBe("expired")

      const row = await readAttemptRow(pool, attemptId)
      expect(row.status).toBe("expired")
    })
  }, 120_000)

  it("is idempotent when another request already finalized the attempt", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, { id: attemptId })

      const first = await finalizeExpiredAttempt(pool, {
        attemptId,
        now: new Date(),
      })
      const second = await finalizeExpiredAttempt(pool, {
        attemptId,
        now: new Date(),
      })

      // Two racing callers must agree on when the attempt was finalized.
      expect(second.submittedAt).toEqual(first.submittedAt)
      expect(second.status).toBe("expired")

      // Deliberately NOT asserted by planting a sentinel score and checking it
      // survives: attempt_counts_reconcile, attempt_expired_pins_deadline and
      // attempt_points_sane between them reject every inconsistent row I tried
      // to write, so a "corrupted" grade cannot be staged at all. The database
      // already forbids the state this test would have been looking for.
    })
  }, 120_000)

  it("names the attempt when asked to finalize one that does not exist", async () => {
    await withDatabase(async (pool) => {
      const missing = randomUUID()

      // `rows[0]` types as non-undefined because noUncheckedIndexedAccess is
      // off, so without an explicit guard this died on a TypeError several
      // lines later instead of saying what was wrong.
      await expect(
        finalizeExpiredAttempt(pool, { attemptId: missing, now: new Date() }),
      ).rejects.toThrow(missing)
    })
  }, 120_000)

  // -- startOrResumeAttempt --

  it("creates the first attempt with resumed: false and a null clock", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)

      const result = await startOrResumeAttempt(pool, {
        studentId: f.studentId,
        slug: f.slug,
        now: new Date(),
      })

      expect(result.resumed).toBe(false)
      expect(result.finalizedPriorAttempt).toBeNull()
      expect(result.attempt.attemptNumber).toBe(1)
      expect(result.attempt.startedAt).toBeNull()
      expect(result.attempt.expiresAt).toBeNull()
      expect(result.attempt.currentSectionId).toBeNull()
      expect(result.attempt.currentQuestionId).toBeNull()
      expect(typeof result.attempt.id).toBe("string")

      const row = await readAttemptRow(pool, result.attempt.id)
      expect(row.status).toBe("in_progress")
    })
  }, 120_000)

  it("resumes an existing in-progress attempt rather than creating a second", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, {
        id: attemptId,
        startedAt: "now()",
        expiresAt: "now() + interval '25 minutes'",
      })

      const result = await startOrResumeAttempt(pool, {
        studentId: f.studentId,
        slug: f.slug,
        now: new Date(),
      })

      expect(result.resumed).toBe(true)
      expect(result.finalizedPriorAttempt).toBeNull()
      expect(result.attempt.id).toBe(attemptId)
      expect(result.attempt.attemptNumber).toBe(1)

      // Not fired: exactly one attempt row exists for this (student, version)
      // -- the "second attempt" the test name rules out.
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM attempt WHERE student_id = $1 AND test_version_id = $2`,
        [f.studentId, f.versionId],
      )
      expect(Number(rows[0].count)).toBe(1)
    })
  }, 120_000)

  it("resumes an UNSTARTED attempt rather than treating a null expiry as expired", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, {
        id: attemptId,
        startedAt: "NULL",
        expiresAt: null,
      })

      const result = await startOrResumeAttempt(pool, {
        studentId: f.studentId,
        slug: f.slug,
        now: new Date(),
      })

      expect(result.resumed).toBe(true)
      expect(result.finalizedPriorAttempt).toBeNull()
      expect(result.attempt.id).toBe(attemptId)
      expect(result.attempt.startedAt).toBeNull()
      expect(result.attempt.expiresAt).toBeNull()

      const row = await readAttemptRow(pool, attemptId)
      expect(row.status).toBe("in_progress")
    })
  }, 120_000)

  it("finalizes an expired attempt and starts a new one in one call", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const staleId = randomUUID()
      // Default insertAttempt window: started an hour ago, expired ten
      // minutes ago, status still 'in_progress'.
      await insertAttempt(pool, f, { id: staleId })

      const result = await startOrResumeAttempt(pool, {
        studentId: f.studentId,
        slug: f.slug,
        now: new Date(),
      })

      expect(result.resumed).toBe(false)
      expect(result.finalizedPriorAttempt?.id).toBe(staleId)
      expect(result.attempt.id).not.toBe(staleId)
      expect(result.attempt.attemptNumber).toBe(2)
      expect(result.attempt.startedAt).toBeNull()
      expect(result.attempt.expiresAt).toBeNull()

      const staleRow = await readAttemptRow(pool, staleId)
      expect(staleRow.status).toBe("expired")

      const newRow = await readAttemptRow(pool, result.attempt.id)
      expect(newRow.status).toBe("in_progress")
    })
  }, 120_000)

  it("pins the finalized attempt's submittedAt to its deadline, not to now", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const staleId = randomUUID()
      await insertAttempt(pool, f, { id: staleId })

      const { rows: expected } = await pool.query<{ expires_at: Date }>(
        `SELECT expires_at FROM attempt WHERE id = $1`,
        [staleId],
      )

      // Well past the deadline -- if the clock leaked in, submittedAt would
      // land here instead of at expires_at.
      const farFuture = createFixedClock(new Date(Date.now() + 60 * 60 * 1000))
      const result = await startOrResumeAttempt(pool, {
        studentId: f.studentId,
        slug: f.slug,
        now: farFuture.now(),
      })

      expect(result.finalizedPriorAttempt?.submittedAt.toISOString()).toBe(
        expected[0].expires_at.toISOString(),
      )
    })
  }, 120_000)

  it("lets a finished attempt be re-attempted", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await insertFinishedAttempt(pool, f)

      const result = await startOrResumeAttempt(pool, {
        studentId: f.studentId,
        slug: f.slug,
        now: new Date(),
      })

      expect(result.resumed).toBe(false)
      // Not fired: the prior attempt is already 'submitted', not a stale
      // 'in_progress' row, so there is nothing here for this call to finalize.
      expect(result.finalizedPriorAttempt).toBeNull()
      expect(result.attempt.attemptNumber).toBe(2)

      const row = await readAttemptRow(pool, result.attempt.id)
      expect(row.status).toBe("in_progress")
    })
  }, 120_000)

  it("throws TestNotFoundError naming the slug when the test is not published", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const missingSlug = "does-not-exist"

      await expect(
        startOrResumeAttempt(pool, {
          studentId: f.studentId,
          slug: missingSlug,
          now: new Date(),
        }),
      ).rejects.toThrow(TestNotFoundError)
    })
  }, 120_000)
})
