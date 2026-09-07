import type { PgPool } from "@liam-public/node-postgres"
import {
  createRequestPool,
  finalizeAttempt,
  loadDbConfig,
  loadResponse,
} from "@pp/db"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import { describe, expect, it } from "vitest"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { createTestApp } from "./helpers/app.js"
import { provisionStudent, seedWriteFixture } from "./helpers/write-fixture.js"

const NOW = new Date("2026-08-27T10:00:00.000Z")
const ATTEMPT_STATUS_LOCK = "SELECT status FROM attempt WHERE id = $1 FOR SHARE"

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

describe.each([
  { label: "PUT /responses/:questionId", method: "put" as const },
  { label: "PATCH /responses", method: "patch" as const },
])("attempt finalizes after the response preflight -- $label", ({ method }) => {
  it("returns the existing 410 and captures the refused write", async () => {
    const lockQueryReached = deferred()
    const releaseLockQuery = deferred()
    let intercepted = false
    const app = await createTestApp({
      now: NOW,
      beforePoolQuery: async (sql) => {
        if (!intercepted && sql.trim() === ATTEMPT_STATUS_LOCK) {
          intercepted = true
          lockQueryReached.resolve()
          await releaseLockQuery.promise
        }
      },
    })
    const pool = app.get<PgPool>(REQUEST_POOL)
    let finalizerPool: PgPool | undefined = undefined

    try {
      const student = await provisionStudent(
        app,
        `attempt-status-${method}-${randomUUID()}`,
      )
      const fixture = await seedWriteFixture(pool, student.studentId)
      const body =
        method === "put"
          ? {
              clientInstanceId: `status-${method}-device`,
              seq: 1,
              selectedChoiceIds: [fixture.choiceIds[0]],
            }
          : {
              clientInstanceId: `status-${method}-device`,
              responses: [
                {
                  questionId: fixture.appliedQuestionId,
                  seq: 1,
                  selectedChoiceIds: [fixture.choiceIds[0]],
                },
              ],
            }
      const url =
        method === "put"
          ? `/api/attempts/${fixture.attemptId}/responses/${fixture.appliedQuestionId}`
          : `/api/attempts/${fixture.attemptId}/responses`
      const agent = request(app.http.getHttpServer() as App)
      const pendingRequest = agent[method](url)
        .set("Authorization", `Bearer ${student.token}`)
        .send(body)
        .then((response) => response)

      await lockQueryReached.promise
      finalizerPool = createRequestPool(loadDbConfig())
      await finalizeAttempt(finalizerPool, {
        attemptId: fixture.attemptId,
        status: "submitted",
        submittedAt: NOW,
      })
      releaseLockQuery.resolve()

      const response = await pendingRequest
      expect(response.status).toBe(410)
      expect(response.body).toEqual({
        type: "attempt_expired",
        title: "The attempt was past its deadline and has been finalized.",
        status: 410,
        retryable: false,
        attempt: {
          id: fixture.attemptId,
          status: "expired",
          submittedAt: NOW.toISOString(),
          resultUrl: `/attempts/${fixture.attemptId}/result`,
        },
      })
      expect(
        await loadResponse(pool, {
          attemptId: fixture.attemptId,
          questionId: fixture.appliedQuestionId,
        }),
      ).toBeNull()

      const { rows } = await pool.query<{
        reason: string
        raw_body: string
        client_instance_id: string | null
      }>(
        `SELECT reason, raw_body, client_instance_id
           FROM failed_write WHERE attempt_id = $1`,
        [fixture.attemptId],
      )
      expect(rows).toEqual([
        {
          reason: "attempt_expired",
          raw_body: JSON.stringify(body),
          client_instance_id: `status-${method}-device`,
        },
      ])
    } finally {
      releaseLockQuery.resolve()
      await finalizerPool?.end()
      await app.close()
    }
  })
})
