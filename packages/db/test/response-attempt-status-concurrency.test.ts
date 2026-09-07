import { randomUUID } from "node:crypto"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import { AttemptNotInProgressError } from "../src/repositories/attempt-not-in-progress.error.js"
import { finalizeAttemptTx } from "../src/repositories/attempt.repository.js"
import {
  applyResponse,
  loadResponse,
  type WriteOutcome,
} from "../src/repositories/response.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest, type Fixture } from "./helpers/fixtures.js"

const NOW = new Date("2026-08-27T10:00:00.000Z")

async function insertAttempt(pool: pg.Pool, fixture: Fixture): Promise<string> {
  const attemptId = randomUUID()
  await pool.query(
    `INSERT INTO attempt (id, student_id, test_version_id, status)
     VALUES ($1, $2, $3, 'in_progress')`,
    [attemptId, fixture.studentId, fixture.versionId],
  )

  return attemptId
}

function responseInput(fixture: Fixture, attemptId: string) {
  return {
    attemptId,
    questionId: fixture.questionIds[0],
    testVersionId: fixture.versionId,
    clientInstanceId: "concurrency-device",
    seq: 1,
    selectedChoiceIds: [fixture.choiceIds[0]],
    answeredAt: NOW,
    timeSpentMs: 500,
    allowAnswerChange: true,
    now: NOW,
  }
}

interface ObservedOperation<T> {
  promise: Promise<
    { kind: "fulfilled"; value: T } | { kind: "rejected"; reason: unknown }
  >
  settled: () => boolean
}

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): Deferred {
  // Seeded with a no-op rather than left undefined or definite-assigned:
  // `init-declarations` requires an initializer, while an initialised
  // `| undefined` makes the usual runtime guard dead code. The Promise
  // executor runs synchronously, so the real resolver is in place before
  // this function returns -- and `resolve` reads the binding at CALL time,
  // so it picks up that reassignment rather than capturing the no-op.
  let resolvePromise: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve: () => {
      resolvePromise()
    },
  }
}

function pauseAfterFirstStatement(
  client: pg.PoolClient,
  firstStatementCompleted: Deferred,
  releaseFirstStatement: Deferred,
): pg.PoolClient {
  let isFirstStatement = true

  return {
    query: async (...args: Parameters<pg.PoolClient["query"]>) => {
      // `pg`'s `query` is overloaded with a callback form that returns void,
      // so spreading the args leaves TypeScript with an ambiguous union and
      // it cannot see that this branch is thenable. The promise form is the
      // one in use here; `Promise.resolve` states that without a cast.
      const result: unknown = await Promise.resolve(client.query(...args))

      if (isFirstStatement) {
        isFirstStatement = false
        firstStatementCompleted.resolve()
        await releaseFirstStatement.promise
      }

      return result
    },
  } as pg.PoolClient
}

function observe<T>(operation: Promise<T>): ObservedOperation<T> {
  let isSettled = false
  const promise = operation
    .then(
      (value) => ({ kind: "fulfilled" as const, value }),
      (reason: unknown) => ({ kind: "rejected" as const, reason }),
    )
    .finally(() => {
      isSettled = true
    })

  return { promise, settled: () => isSettled }
}

async function backendPid(client: pg.PoolClient): Promise<number> {
  const { rows } = await client.query<{ pid: number }>(
    "SELECT pg_backend_pid() AS pid",
  )

  return rows[0].pid
}

async function waitUntilBlockedOrSettled(
  observer: pg.PoolClient,
  input: {
    blockedPid: number
    blockerPid: number
    settled: () => boolean
  },
): Promise<"blocked" | "settled"> {
  // This polls pg_blocking_pids until one connection is seen blocking the
  // other. The awaits are sequential BY DESIGN: running them in parallel
  // would ask the same question a thousand times at once instead of watching
  // a lock develop over time.
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- see above
    const { rows } = await observer.query<{ blocked: boolean }>(
      `SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked`,
      [input.blockerPid, input.blockedPid],
    )

    if (rows[0].blocked) {
      return "blocked"
    }

    if (input.settled()) {
      return "settled"
    }
  }

  throw new Error("competing query neither blocked nor settled")
}

async function rollbackIfOpen(
  client: pg.PoolClient,
  isOpen: boolean,
): Promise<void> {
  if (isOpen) {
    await client.query("ROLLBACK")
  }
}

describe("response write and attempt finalization concurrency", () => {
  it("write first: finalization waits for the response commit and grades that answer", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)
      const writer = await pool.connect()
      const finalizer = await pool.connect()
      let writerOpen = false
      let finalizerOpen = false
      let observedFinalization:
        | ObservedOperation<Awaited<ReturnType<typeof finalizeAttemptTx>>>
        | undefined = undefined
      let observedWrite: ObservedOperation<WriteOutcome> | undefined = undefined
      const firstStatementCompleted = deferred()
      const releaseFirstStatement = deferred()
      let firstStatementReleased = false

      try {
        const writerPid = await backendPid(writer)
        const finalizerPid = await backendPid(finalizer)
        await writer.query("BEGIN")
        writerOpen = true
        observedWrite = observe(
          applyResponse(
            pauseAfterFirstStatement(
              writer,
              firstStatementCompleted,
              releaseFirstStatement,
            ),
            responseInput(fixture, attemptId),
          ),
        )
        await firstStatementCompleted.promise

        await finalizer.query("BEGIN")
        finalizerOpen = true
        observedFinalization = observe(
          finalizeAttemptTx(finalizer, {
            attemptId,
            status: "submitted",
            submittedAt: NOW,
          }),
        )

        expect(
          await waitUntilBlockedOrSettled(writer, {
            blockedPid: finalizerPid,
            blockerPid: writerPid,
            settled: observedFinalization.settled,
          }),
        ).toBe("blocked")

        releaseFirstStatement.resolve()
        firstStatementReleased = true
        expect(await observedWrite.promise).toEqual({
          kind: "fulfilled",
          value: { kind: "applied" },
        })
        await writer.query("COMMIT")
        writerOpen = false
        const finalization = await observedFinalization.promise
        expect(finalization).toMatchObject({
          kind: "fulfilled",
          value: { pointsEarned: 1, answered: 1, correct: 1 },
        })
        await finalizer.query("COMMIT")
        finalizerOpen = false

        const { rows } = await pool.query<{
          status: string
          points_earned: number
          answered_count: number
        }>(
          `SELECT status, points_earned, answered_count
             FROM attempt WHERE id = $1`,
          [attemptId],
        )
        expect(rows).toEqual([
          { status: "submitted", points_earned: 1, answered_count: 1 },
        ])
      } finally {
        await rollbackIfOpen(finalizer, finalizerOpen)

        if (!firstStatementReleased) {
          releaseFirstStatement.resolve()
        }

        if (observedWrite) {
          await observedWrite.promise
        }

        await rollbackIfOpen(writer, writerOpen)

        if (observedFinalization) {
          await observedFinalization.promise
        }

        writer.release()
        finalizer.release()
      }
    })
  }, 120_000)

  it("finalize first: the response waits, then refuses without persisting", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)
      const writer = await pool.connect()
      const finalizer = await pool.connect()
      let writerOpen = false
      let finalizerOpen = false
      let observedWrite: ObservedOperation<WriteOutcome> | undefined = undefined

      try {
        const writerPid = await backendPid(writer)
        const finalizerPid = await backendPid(finalizer)
        await finalizer.query("BEGIN")
        finalizerOpen = true
        expect(
          await finalizeAttemptTx(finalizer, {
            attemptId,
            status: "submitted",
            submittedAt: NOW,
          }),
        ).toMatchObject({ pointsEarned: 0, answered: 0 })

        await writer.query("BEGIN")
        writerOpen = true
        observedWrite = observe(
          applyResponse(writer, responseInput(fixture, attemptId)),
        )

        expect(
          await waitUntilBlockedOrSettled(finalizer, {
            blockedPid: writerPid,
            blockerPid: finalizerPid,
            settled: observedWrite.settled,
          }),
        ).toBe("blocked")

        await finalizer.query("COMMIT")
        finalizerOpen = false
        const write = await observedWrite.promise
        expect(write.kind).toBe("rejected")

        if (write.kind !== "rejected") {
          throw new Error("response write unexpectedly fulfilled")
        }

        expect(write.reason).toBeInstanceOf(AttemptNotInProgressError)
        await writer.query("ROLLBACK")
        writerOpen = false

        expect(
          await loadResponse(pool, {
            attemptId,
            questionId: fixture.questionIds[0],
          }),
        ).toBeNull()
        const { rows } = await pool.query<{
          status: string
          points_earned: number
          answered_count: number
        }>(
          `SELECT status, points_earned, answered_count
             FROM attempt WHERE id = $1`,
          [attemptId],
        )
        expect(rows).toEqual([
          { status: "submitted", points_earned: 0, answered_count: 0 },
        ])
      } finally {
        await rollbackIfOpen(finalizer, finalizerOpen)

        if (observedWrite) {
          await observedWrite.promise
        }

        await rollbackIfOpen(writer, writerOpen)
        writer.release()
        finalizer.release()
      }
    })
  }, 120_000)
})
