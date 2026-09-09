import { randomUUID } from "node:crypto"
import type { PgQueryable } from "@liam-workspace/node-postgres"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import {
  finalizeAttempt,
  submitAttempt,
  type AttemptRow,
} from "../src/repositories/attempt.repository.js"
import {
  applyResponse,
  loadResponse,
  type WriteOutcome,
} from "../src/repositories/response.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest, type Fixture } from "./helpers/fixtures.js"

const NOW = new Date("2026-08-27T10:00:00.000Z")
const FUTURE = new Date("2026-08-27T11:00:00.000Z")
const PAST = new Date("2026-08-27T09:00:00.000Z")

async function insertAttempt(
  pool: pg.Pool,
  fixture: Fixture,
  input: {
    attemptId?: string
    expiresAt?: Date
    sectionId?: string
    questionId?: string
  } = {},
): Promise<string> {
  const attemptId = input.attemptId ?? randomUUID()
  const sectionId = input.sectionId ?? fixture.readingSectionId
  const questionId = input.questionId ?? fixture.questionIds[1]
  const expiresAt = input.expiresAt ?? FUTURE

  await pool.query(
    `INSERT INTO attempt
       (id, student_id, test_version_id, status, started_at, expires_at,
        current_section_id, current_question_id)
     VALUES ($1, $2, $3, 'in_progress', $4, $5, $6, $7)`,
    [
      attemptId,
      fixture.studentId,
      fixture.versionId,
      new Date("2026-08-27T08:00:00.000Z"),
      expiresAt,
      sectionId,
      questionId,
    ],
  )
  await pool.query(
    `INSERT INTO attempt_section
       (attempt_id, test_section_id, test_version_id, entered_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      attemptId,
      sectionId,
      fixture.versionId,
      new Date("2026-08-27T08:30:00.000Z"),
      expiresAt,
    ],
  )

  return attemptId
}

function applyTestRemainder(input: {
  tx: PgQueryable
  attempt: AttemptRow
  fixture: Fixture
  seq?: number
  selectedChoiceIds?: string[]
}): Promise<WriteOutcome> {
  const { tx, attempt, fixture } = input

  return applyResponse(tx, {
    attemptId: attempt.id,
    questionId: fixture.questionIds[1],
    testVersionId: attempt.testVersionId,
    clientInstanceId: "submit-device",
    seq: input.seq ?? 1,
    selectedChoiceIds: input.selectedChoiceIds ?? [fixture.choiceIds[2]],
    answeredAt: NOW,
    timeSpentMs: 750,
    allowAnswerChange: true,
    now: NOW,
  })
}

function remainderFor(
  fixture: Fixture,
  selectedChoiceIds?: string[],
): (tx: PgQueryable, attempt: AttemptRow) => Promise<WriteOutcome[]> {
  return async (tx, attempt) => [
    await applyTestRemainder({ tx, attempt, fixture, selectedChoiceIds }),
  ]
}

function emptyRemainder(): Promise<WriteOutcome[]> {
  return Promise.resolve([])
}

function forbiddenRemainder(message: string): () => never {
  return () => {
    throw new Error(message)
  }
}

describe("submitAttempt", () => {
  it("grades and finalizes as submitted, returning alreadySubmitted: false", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)

      const outcome = await submitAttempt(pool, {
        attemptId,
        now: NOW,
        applyRemainder: remainderFor(fixture),
      })

      expect(outcome).toMatchObject({
        kind: "submitted",
        alreadySubmitted: false,
        finalized: {
          status: "submitted",
          submittedAt: NOW,
          pointsEarned: 1,
          pointsPossible: 2,
        },
        finalFlush: [{ kind: "applied" }],
      })
    })
  }, 120_000)

  it("is idempotent: an already-submitted attempt returns the same cached score without applying a remainder", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)
      const first = await submitAttempt(pool, {
        attemptId,
        now: NOW,
        applyRemainder: remainderFor(fixture),
      })

      const second = await submitAttempt(pool, {
        attemptId,
        now: new Date("2026-08-27T10:30:00.000Z"),
        applyRemainder: forbiddenRemainder(
          "an already-submitted attempt must not apply a remainder",
        ),
      })

      expect(second).toEqual({
        ...first,
        alreadySubmitted: true,
        finalFlush: [],
      })
    })
  }, 120_000)

  it("refuses with nothing_answered when there are no response_choice rows", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)

      const outcome = await submitAttempt(pool, {
        attemptId,
        now: NOW,
        applyRemainder: emptyRemainder,
      })

      expect(outcome).toEqual({ kind: "nothing_answered" })
      const { rows } = await pool.query<{ status: string }>(
        "SELECT status FROM attempt WHERE id = $1",
        [attemptId],
      )
      expect(rows[0]?.status).toBe("in_progress")
    })
  }, 120_000)

  it("counts the remainder's only answer in the resulting score", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)

      const outcome = await submitAttempt(pool, {
        attemptId,
        now: NOW,
        applyRemainder: remainderFor(fixture),
      })

      expect(outcome.kind).toBe("submitted")

      if (outcome.kind !== "submitted") {
        throw new Error(`expected submitted, received ${outcome.kind}`)
      }

      expect(outcome.finalized.pointsEarned).toBe(1)
      expect(outcome.finalized.answered).toBe(1)
      expect(outcome.finalized.unanswered).toBe(1)
    })
  }, 120_000)

  it("finalizes as expired and pins submittedAt to expiresAt when called past the deadline", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture, {
        expiresAt: PAST,
      })

      const outcome = await submitAttempt(pool, {
        attemptId,
        now: NOW,
        applyRemainder: forbiddenRemainder(
          "an expired attempt must not apply its remainder",
        ),
      })

      expect(outcome).toMatchObject({
        kind: "already_expired",
        finalized: { status: "expired", submittedAt: PAST },
      })
      const { rows } = await pool.query<{
        submitted_at: Date
        expires_at: Date
      }>("SELECT submitted_at, expires_at FROM attempt WHERE id = $1", [
        attemptId,
      ])
      expect(rows[0]?.submitted_at).toEqual(rows[0]?.expires_at)
    })
  }, 120_000)

  it("returns already_expired for an attempt another caller already finalized", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture, {
        expiresAt: PAST,
      })
      await finalizeAttempt(pool, {
        attemptId,
        status: "expired",
        submittedAt: PAST,
      })

      const outcome = await submitAttempt(pool, {
        attemptId,
        now: NOW,
        applyRemainder: forbiddenRemainder(
          "a terminal attempt must not apply its remainder",
        ),
      })

      expect(outcome).toMatchObject({
        kind: "already_expired",
        finalized: { status: "expired", submittedAt: PAST },
      })
    })
  }, 120_000)

  it("returns not_found for an unknown attempt id", async () => {
    await withDatabase(async (pool) => {
      await seedPublishedTest(pool)

      const outcome = await submitAttempt(pool, {
        attemptId: randomUUID(),
        now: NOW,
        applyRemainder: forbiddenRemainder(
          "an unknown attempt must not apply a remainder",
        ),
      })

      expect(outcome).toEqual({ kind: "not_found" })
    })
  }, 120_000)

  it("commits a cleared remainder response even when the verdict is nothing_answered", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)

      const outcome = await submitAttempt(pool, {
        attemptId,
        now: NOW,
        applyRemainder: remainderFor(fixture, []),
      })

      expect(outcome).toEqual({ kind: "nothing_answered" })
      expect(
        await loadResponse(pool, {
          attemptId,
          questionId: fixture.questionIds[1],
        }),
      ).toEqual({
        clientInstanceId: "submit-device",
        seq: 1,
        selectedChoiceIds: [],
      })
    })
  }, 120_000)
})
