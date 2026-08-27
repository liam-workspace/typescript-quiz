import { randomUUID } from "node:crypto"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import { finalizeAttempt } from "../src/repositories/attempt.repository.js"
import { loadAttemptResult } from "../src/repositories/attempt-result.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest, type Fixture } from "./helpers/fixtures.js"

const NOW = new Date("2026-08-27T10:00:00.000Z")
const STARTED_AT = new Date("2026-08-27T09:30:00.000Z")
const FUTURE = new Date("2026-08-27T10:30:00.000Z")
const PAST = new Date("2026-08-27T09:45:00.000Z")

function sumPointsEarned(sections: Array<{ pointsEarned: number }>): number {
  let total = 0

  for (const section of sections) {
    total += section.pointsEarned
  }

  return total
}

async function insertAttempt(
  pool: pg.Pool,
  fixture: Fixture,
  input: { expiresAt?: Date; startedAt?: Date } = {},
): Promise<string> {
  const attemptId = randomUUID()

  await pool.query(
    `INSERT INTO attempt
       (id, student_id, test_version_id, status, started_at, expires_at)
     VALUES ($1, $2, $3, 'in_progress', $4, $5)`,
    [
      attemptId,
      fixture.studentId,
      fixture.versionId,
      input.startedAt ?? STARTED_AT,
      input.expiresAt ?? FUTURE,
    ],
  )

  return attemptId
}

async function recordAnswer(
  pool: pg.Pool,
  fixture: Fixture,
  input: { attemptId: string; questionIndex: number; choiceIndex: number },
): Promise<void> {
  await pool.query(
    `INSERT INTO response
       (attempt_id, question_id, test_version_id, client_instance_id, client_seq)
     VALUES ($1, $2, $3, 'result-test', 1)`,
    [
      input.attemptId,
      fixture.questionIds[input.questionIndex],
      fixture.versionId,
    ],
  )
  await pool.query(
    `INSERT INTO response_choice (attempt_id, question_id, choice_id)
     VALUES ($1, $2, $3)`,
    [
      input.attemptId,
      fixture.questionIds[input.questionIndex],
      fixture.choiceIds[input.choiceIndex],
    ],
  )
}

async function finishAttempt(
  pool: pg.Pool,
  fixture: Fixture,
  input: {
    questionIndex: number
    choiceIndex: number
    submittedAt?: Date
  },
): Promise<string> {
  const attemptId = await insertAttempt(pool, fixture)
  await recordAnswer(pool, fixture, { attemptId, ...input })
  await finalizeAttempt(pool, {
    attemptId,
    status: "submitted",
    submittedAt: input.submittedAt ?? NOW,
  })

  return attemptId
}

describe("loadAttemptResult", () => {
  it("returns not_found for an unknown attempt", async () => {
    await withDatabase(async (pool) => {
      const result = await loadAttemptResult(pool, {
        attemptId: randomUUID(),
        now: NOW,
      })

      expect(result).toEqual({ kind: "not_found" })
    })
  }, 120_000)

  it("returns still_running for an in-progress attempt before its deadline", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)

      const result = await loadAttemptResult(pool, { attemptId, now: NOW })

      expect(result).toEqual({ kind: "still_running" })
    })
  }, 120_000)

  it("reports a past-deadline attempt as expired_unfinalized, and writes nothing", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture, {
        expiresAt: PAST,
        startedAt: new Date("2026-08-27T09:00:00.000Z"),
      })

      const result = await loadAttemptResult(pool, { attemptId, now: NOW })
      const { rows } = await pool.query<{
        status: string
        submitted_at: Date | null
        points_earned: number | null
      }>(
        `SELECT status, submitted_at, points_earned
           FROM attempt WHERE id = $1`,
        [attemptId],
      )

      // A repository read never writes -- finalizing is the service's job,
      // using the idempotent finalizeAttempt. But it must report the two
      // cases DIFFERENTLY, because they mean opposite things to a caller:
      // "still running" is a refusal (409 StillRunning), while a spent clock
      // means the result has just become available and must be finalized and
      // returned, not denied.
      expect(result).toEqual({ kind: "expired_unfinalized", expiresAt: PAST })
      expect(rows).toEqual([
        { status: "in_progress", submitted_at: null, points_earned: null },
      ])
    })
  }, 120_000)

  it("returns the cached score and a matching fresh section breakdown", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await finishAttempt(pool, fixture, {
        questionIndex: 1,
        choiceIndex: 2,
      })

      const result = await loadAttemptResult(pool, { attemptId, now: NOW })

      expect(result).toMatchObject({
        kind: "ready",
        result: {
          attemptId,
          testTitle: "TOEFL Primary — Practice Test 04",
          testVersion: 1,
          status: "submitted",
          submittedAt: NOW,
          elapsedSeconds: 1800,
          score: {
            pointsEarned: 1,
            pointsPossible: 2,
            percentage: 50,
            answered: 1,
            unanswered: 1,
            correct: 1,
            incorrect: 0,
          },
        },
      })

      if (result.kind !== "ready") {
        throw new Error(`expected ready, received ${result.kind}`)
      }

      expect(typeof result.result.score.percentage).toBe("number")
      expect(sumPointsEarned(result.result.score.sections)).toBe(
        result.result.score.pointsEarned,
      )
    })
  }, 120_000)

  it("marks the only finished attempt on a version as a personal best", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await finishAttempt(pool, fixture, {
        questionIndex: 1,
        choiceIndex: 2,
      })

      const result = await loadAttemptResult(pool, { attemptId, now: NOW })

      expect(result).toMatchObject({
        kind: "ready",
        result: { isPersonalBest: true },
      })
    })
  }, 120_000)

  it("compares personal bests only against this student's finished attempts on the same version", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const bestId = await finishAttempt(pool, fixture, {
        questionIndex: 1,
        choiceIndex: 2,
        submittedAt: new Date("2026-08-27T09:50:00.000Z"),
      })
      const lowerId = await finishAttempt(pool, fixture, {
        questionIndex: 1,
        choiceIndex: 3,
      })

      const [best, lower] = await Promise.all([
        loadAttemptResult(pool, { attemptId: bestId, now: NOW }),
        loadAttemptResult(pool, { attemptId: lowerId, now: NOW }),
      ])

      expect(best).toMatchObject({
        kind: "ready",
        result: { score: { pointsEarned: 1 }, isPersonalBest: true },
      })
      expect(lower).toMatchObject({
        kind: "ready",
        result: { score: { pointsEarned: 0 }, isPersonalBest: false },
      })
    })
  }, 120_000)
})
