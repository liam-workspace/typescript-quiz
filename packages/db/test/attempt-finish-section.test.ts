import { randomUUID } from "node:crypto"
import type { PgQueryable } from "@liam-workspace/node-postgres"
import type pg from "pg"
import { describe, expect, it, vi } from "vitest"
import {
  finishSection,
  type AttemptRow,
} from "../src/repositories/attempt.repository.js"
import { applyResponse } from "../src/repositories/response.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest, type Fixture } from "./helpers/fixtures.js"

const NOW = new Date("2026-08-28T09:10:00.000Z")
const ATTEMPT_EXPIRES_AT = new Date("2026-08-28T10:00:00.000Z")
const SECTION_EXPIRES_AT = new Date("2026-08-28T09:25:00.000Z")

async function insertOpenAttempt(
  pool: pg.Pool,
  fixture: Fixture,
): Promise<string> {
  const attemptId = randomUUID()

  await pool.query(
    `INSERT INTO attempt
       (id, student_id, test_version_id, status, started_at, expires_at,
        current_section_id, current_question_id)
     VALUES ($1, $2, $3, 'in_progress', $4, $5, $6, $7)`,
    [
      attemptId,
      fixture.studentId,
      fixture.versionId,
      new Date("2026-08-28T09:00:00.000Z"),
      ATTEMPT_EXPIRES_AT,
      fixture.listeningSectionId,
      fixture.questionIds[0],
    ],
  )
  await pool.query(
    `INSERT INTO attempt_section
       (attempt_id, test_section_id, test_version_id, entered_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      attemptId,
      fixture.listeningSectionId,
      fixture.versionId,
      new Date("2026-08-28T09:00:00.000Z"),
      SECTION_EXPIRES_AT,
    ],
  )

  return attemptId
}

async function recordCorrectListeningAnswer(
  tx: PgQueryable,
  attempt: AttemptRow,
  fixture: Fixture,
): Promise<{ questionId: string; status: "applied" }> {
  const outcome = await applyResponse(tx, {
    attemptId: attempt.id,
    questionId: fixture.questionIds[0],
    testVersionId: attempt.testVersionId,
    clientInstanceId: "finish-device",
    seq: 1,
    selectedChoiceIds: [fixture.choiceIds[0]],
    answeredAt: NOW,
    timeSpentMs: 500,
    allowAnswerChange: false,
    now: NOW,
  })

  if (outcome.kind !== "applied") {
    throw new Error(`expected applied response, received ${outcome.kind}`)
  }

  return { questionId: fixture.questionIds[0], status: "applied" }
}

function asSingleItem<T>(item: T): T[] {
  return [item]
}

function correctRemainder(fixture: Fixture) {
  return (tx: PgQueryable, attempt: AttemptRow) =>
    recordCorrectListeningAnswer(tx, attempt, fixture).then(asSingleItem)
}

function emptyRemainder(): Promise<never[]> {
  return Promise.resolve([])
}

describe("finishSection", () => {
  it("applies the queue remainder, closes and grades the current section, and returns the next section", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertOpenAttempt(pool, fixture)

      const outcome = await finishSection(pool, {
        attemptId,
        sectionId: fixture.listeningSectionId,
        now: NOW,
        applyRemainder: correctRemainder(fixture),
      })

      expect(outcome).toEqual({
        kind: "finished",
        nextSectionId: fixture.readingSectionId,
        finalFlush: [{ questionId: fixture.questionIds[0], status: "applied" }],
      })

      const { rows } = await pool.query<{
        completed_at: Date
        points_earned: number
        points_possible: number
        answered_count: number
        unanswered_count: number
        correct_count: number
        incorrect_count: number
      }>(
        `SELECT completed_at, points_earned, points_possible,
                answered_count, unanswered_count, correct_count, incorrect_count
           FROM attempt_section
          WHERE attempt_id = $1 AND test_section_id = $2`,
        [attemptId, fixture.listeningSectionId],
      )

      expect(rows).toEqual([
        {
          completed_at: NOW,
          points_earned: 1,
          points_possible: 1,
          answered_count: 1,
          unanswered_count: 0,
          correct_count: 1,
          incorrect_count: 0,
        },
      ])
    })
  }, 120_000)

  it("is idempotent while that finished section remains current and does not re-grade it", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertOpenAttempt(pool, fixture)
      const applyRemainder = vi.fn(correctRemainder(fixture))

      const first = await finishSection(pool, {
        attemptId,
        sectionId: fixture.listeningSectionId,
        now: NOW,
        applyRemainder,
      })

      await pool.query(
        `DELETE FROM response_choice
          WHERE attempt_id = $1 AND question_id = $2`,
        [attemptId, fixture.questionIds[0]],
      )

      const second = await finishSection(pool, {
        attemptId,
        sectionId: fixture.listeningSectionId,
        now: new Date("2026-08-28T09:11:00.000Z"),
        applyRemainder,
      })

      expect(first).toMatchObject({
        kind: "finished",
        nextSectionId: fixture.readingSectionId,
      })
      expect(second).toEqual({
        kind: "finished",
        nextSectionId: fixture.readingSectionId,
        finalFlush: [],
      })
      expect(applyRemainder).toHaveBeenCalledTimes(1)

      const { rows } = await pool.query<{
        completed_at: Date
        points_earned: number
        answered_count: number
      }>(
        `SELECT completed_at, points_earned, answered_count
           FROM attempt_section
          WHERE attempt_id = $1 AND test_section_id = $2`,
        [attemptId, fixture.listeningSectionId],
      )

      expect(rows).toEqual([
        {
          completed_at: NOW,
          points_earned: 1,
          answered_count: 1,
        },
      ])
    })
  }, 120_000)

  it("returns no next section when the current open section is final", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertOpenAttempt(pool, fixture)

      await pool.query(
        `UPDATE attempt
            SET current_section_id = $2, current_question_id = $3
          WHERE id = $1`,
        [attemptId, fixture.readingSectionId, fixture.questionIds[1]],
      )
      await pool.query(
        `UPDATE attempt_section
            SET test_section_id = $2
          WHERE attempt_id = $1`,
        [attemptId, fixture.readingSectionId],
      )

      const outcome = await finishSection(pool, {
        attemptId,
        sectionId: fixture.readingSectionId,
        now: NOW,
        applyRemainder: emptyRemainder,
      })

      expect(outcome).toEqual({
        kind: "finished",
        nextSectionId: null,
        finalFlush: [],
      })
    })
  }, 120_000)
})
