import { randomUUID } from "node:crypto"
import { withTransaction, type PgQueryable } from "@liam-workspace/node-postgres"
import type pg from "pg"
import { describe, expect, it } from "vitest"
// The transaction-scoped finalizer is deliberately reached only via this
// relative import -- it must NOT be part of @pp/db's public surface (see
// index.ts), because Task 6 needs it to run inside a transaction it already
// owns (applying the final responses and finalizing must be one atomic
// unit), while every other caller (Tasks 7-8) only ever needs the
// pool-opening finalizeAttempt.
import {
  finalizeAttempt,
  finalizeAttemptTx,
} from "../src/repositories/attempt.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest, type Fixture } from "./helpers/fixtures.js"

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

/**
 * A real in-progress attempt row, still open. finalizeAttempt never reads
 * `now` itself -- it takes submittedAt as an explicit argument -- so the
 * clock/expiry fields here only need to satisfy attempt_clock_paired; they
 * are not what drives any assertion in this file.
 */
async function insertAttempt(
  pool: pg.Pool,
  f: Fixture,
  input: { id: string; startedAt?: string; expiresAt?: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO attempt (id, student_id, test_version_id, status, started_at, expires_at)
     VALUES ($1, $2, $3, 'in_progress', ${
       input.startedAt ?? "now() - interval '1 hour'"
     }, ${input.expiresAt ?? "now() - interval '10 minutes'"})`,
    [input.id, f.studentId, f.versionId],
  )
}

async function readAttemptRow(
  pool: pg.Pool,
  attemptId: string,
): Promise<RawAttemptRow> {
  const { rows } = await pool.query<RawAttemptRow>(
    `SELECT status, submitted_at, points_earned, points_possible, percentage,
            answered_count, unanswered_count, correct_count, incorrect_count,
            question_count
       FROM attempt WHERE id = $1`,
    [attemptId],
  )
  const [row] = rows

  return row
}

interface SectionResultLike {
  type: string
  pointsEarned: number
  pointsPossible: number
}

function sectionByType(
  sections: SectionResultLike[] | undefined,
  type: string,
): SectionResultLike | undefined {
  return sections?.find((s) => s.type === type)
}

/**
 * Task 6's exact shape: apply the final response AND finalize as ONE
 * atomic unit inside a transaction it already owns. Kept as its own
 * top-level function (rather than inlined in the test) so the test body
 * does not nest a fourth callback (it > withDatabase > withTransaction).
 */
function finalizeWithFinalResponse(
  pool: pg.Pool,
  input: {
    attemptId: string
    versionId: string
    questionId: string
    choiceId: string
  },
): Promise<Awaited<ReturnType<typeof finalizeAttemptTx>>> {
  return withTransaction(pool, async (tx) => {
    await tx.query(
      `INSERT INTO response (attempt_id, question_id, test_version_id, client_instance_id, client_seq)
       VALUES ($1, $2, $3, 'ci', 1)`,
      [input.attemptId, input.questionId, input.versionId],
    )
    await tx.query(
      `INSERT INTO response_choice (attempt_id, question_id, choice_id)
       VALUES ($1, $2, $3)`,
      [input.attemptId, input.questionId, input.choiceId],
    )

    return finalizeAttemptTx(tx, {
      attemptId: input.attemptId,
      status: "submitted",
      submittedAt: new Date(),
    })
  })
}

async function recordAnswer(
  db: PgQueryable,
  input: {
    versionId: string
    attemptId: string
    questionId: string
    choiceId: string
  },
): Promise<void> {
  await db.query(
    `INSERT INTO response (attempt_id, question_id, test_version_id, client_instance_id, client_seq)
     VALUES ($1, $2, $3, 'ci', 1)`,
    [input.attemptId, input.questionId, input.versionId],
  )
  await db.query(
    `INSERT INTO response_choice (attempt_id, question_id, choice_id)
     VALUES ($1, $2, $3)`,
    [input.attemptId, input.questionId, input.choiceId],
  )
}

describe("finalizeAttempt", () => {
  it("grades an unanswered attempt as 0/2 and marks every question unanswered", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, { id: attemptId })
      const submittedAt = new Date()

      const result = await finalizeAttempt(pool, {
        attemptId,
        status: "submitted",
        submittedAt,
      })

      expect(result?.pointsEarned).toBe(0)
      expect(result?.pointsPossible).toBe(2)
      expect(result?.percentage).toBe(0)
      expect(result?.answered).toBe(0)
      expect(result?.unanswered).toBe(2)
      expect(result?.correct).toBe(0)
      expect(result?.incorrect).toBe(0)

      const row = await readAttemptRow(pool, attemptId)
      expect(row.status).toBe("submitted")
      expect(row.points_earned).toBe(0)
      expect(row.points_possible).toBe(2)
      expect(Number(row.percentage)).toBe(0)
      expect(row.answered_count).toBe(0)
      expect(row.unanswered_count).toBe(2)
      expect(row.correct_count).toBe(0)
      expect(row.incorrect_count).toBe(0)
      expect(row.question_count).toBe(2)
    })
  }, 120_000)

  it("grades a fully-correct attempt as 2/2", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, { id: attemptId })
      const [q1, q2] = f.questionIds
      // The first choice is q1's correct choice, the third is q2's.
      const [c1, , c3] = f.choiceIds

      await recordAnswer(pool, {
        versionId: f.versionId,
        attemptId,
        questionId: q1,
        choiceId: c1,
      })
      await recordAnswer(pool, {
        versionId: f.versionId,
        attemptId,
        questionId: q2,
        choiceId: c3,
      })

      const result = await finalizeAttempt(pool, {
        attemptId,
        status: "submitted",
        submittedAt: new Date(),
      })

      expect(result?.pointsEarned).toBe(2)
      expect(result?.pointsPossible).toBe(2)
      expect(result?.percentage).toBe(100)
      expect(result?.answered).toBe(2)
      expect(result?.unanswered).toBe(0)
      expect(result?.correct).toBe(2)
      expect(result?.incorrect).toBe(0)
    })
  }, 120_000)

  it("writes status and submittedAt exactly as given", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, { id: attemptId })
      // Deliberately not "now" -- proves the value written is the caller's
      // argument, not something finalizeAttempt derived on its own.
      const submittedAt = new Date("2026-01-15T09:30:00.000Z")

      const result = await finalizeAttempt(pool, {
        attemptId,
        status: "submitted",
        submittedAt,
      })

      expect(result?.status).toBe("submitted")
      expect(result?.submittedAt.toISOString()).toBe(submittedAt.toISOString())

      const row = await readAttemptRow(pool, attemptId)
      expect(row.status).toBe("submitted")
      expect(row.submitted_at?.toISOString()).toBe(submittedAt.toISOString())
    })
  }, 120_000)

  it("pins submittedAt to the given deadline, not to a later now, when called for an expired attempt", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      const startedAt = "'2026-01-09T00:00:00.000Z'"
      const expiresAt = "'2026-01-10T00:00:00.000Z'"
      await insertAttempt(pool, f, { id: attemptId, startedAt, expiresAt })

      const { rows } = await pool.query<{ expires_at: Date }>(
        `SELECT expires_at FROM attempt WHERE id = $1`,
        [attemptId],
      )
      const [{ expires_at: deadline }] = rows

      // A Clock is irrelevant here -- finalizeAttempt takes submittedAt as
      // an explicit argument precisely so the caller (Task 6/7) controls
      // this, not an injected Clock.
      const result = await finalizeAttempt(pool, {
        attemptId,
        status: "expired",
        submittedAt: deadline,
      })

      expect(result?.submittedAt.toISOString()).toBe(deadline.toISOString())
      // And definitely not "now", which is long after this fixed deadline.
      expect(result?.submittedAt.getTime()).toBeLessThan(Date.now())
    })
  }, 120_000)

  it("is idempotent: a second call with a DIFFERENT status/submittedAt does not change the stored result", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, { id: attemptId })
      const t1 = new Date("2026-01-01T00:00:00.000Z")
      const t2 = new Date("2026-06-01T00:00:00.000Z")

      const first = await finalizeAttempt(pool, {
        attemptId,
        status: "submitted",
        submittedAt: t1,
      })

      const second = await finalizeAttempt(pool, {
        attemptId,
        status: "expired",
        submittedAt: t2,
      })

      // A caller passing IDENTICAL values by luck would pass this
      // vacuously; t1 !== t2 and "submitted" !== "expired" is what proves
      // the second call's input was actually ignored, not coincidentally
      // equal.
      expect(second?.status).toBe("submitted")
      expect(second?.submittedAt.toISOString()).toBe(t1.toISOString())
      expect(second?.status).toBe(first?.status)
      expect(second?.submittedAt.toISOString()).toBe(
        first?.submittedAt.toISOString(),
      )

      const row = await readAttemptRow(pool, attemptId)
      expect(row.status).toBe("submitted")
      expect(row.submitted_at?.toISOString()).toBe(t1.toISOString())
    })
  }, 120_000)

  it("returns null for an attempt id that does not exist", async () => {
    await withDatabase(async (pool) => {
      const missing = randomUUID()

      const result = await finalizeAttempt(pool, {
        attemptId: missing,
        status: "submitted",
        submittedAt: new Date(),
      })

      expect(result).toBeNull()
    })
  }, 120_000)

  it("sums pointsEarned across BOTH sections into the attempt-level total", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, { id: attemptId })
      const [q1, q2] = f.questionIds
      // Correct for q1 (listening); q2 left unanswered.
      const [c1] = f.choiceIds

      await recordAnswer(pool, {
        versionId: f.versionId,
        attemptId,
        questionId: q1,
        choiceId: c1,
      })

      const result = await finalizeAttempt(pool, {
        attemptId,
        status: "submitted",
        submittedAt: new Date(),
      })

      expect(result?.pointsEarned).toBe(1)
      expect(result?.pointsPossible).toBe(2)
      expect(result?.sections).toHaveLength(2)

      const listening = sectionByType(result?.sections, "listening")
      const reading = sectionByType(result?.sections, "reading")
      expect(listening?.pointsEarned).toBe(1)
      expect(listening?.pointsPossible).toBe(1)
      expect(reading?.pointsEarned).toBe(0)
      expect(reading?.pointsPossible).toBe(1)
      expect(q2).toBeDefined()
    })
  }, 120_000)

  // The transaction-scoped finalizer, reached only through the relative
  // import above -- the exact shape Task 6 needs: applying a final
  // response and finalizing as ONE atomic unit inside a transaction it
  // already owns.
  it("finalizeAttemptTx grades correctly when composed with another write in the SAME transaction", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      await insertAttempt(pool, f, { id: attemptId })
      const [q1] = f.questionIds
      const [c1] = f.choiceIds

      const scored = await finalizeWithFinalResponse(pool, {
        attemptId,
        versionId: f.versionId,
        questionId: q1,
        choiceId: c1,
      })

      expect(scored?.pointsEarned).toBe(1)
      expect(scored?.answered).toBe(1)
      expect(scored?.correct).toBe(1)

      const row = await readAttemptRow(pool, attemptId)
      expect(row.status).toBe("submitted")
      expect(row.points_earned).toBe(1)
    })
  }, 120_000)
})
