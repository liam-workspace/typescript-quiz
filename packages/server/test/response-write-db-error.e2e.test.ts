import type { PgPool } from "@liam-public/node-postgres"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { createTestApp, type TestApp } from "./helpers/app.js"
import {
  provisionStudent,
  seedWriteFixture,
  type WriteFixture,
} from "./helpers/write-fixture.js"

const NOW = new Date("2026-08-27T10:00:00.000Z")

// A synthetic, unrecognised database error -- the exact shape a real
// deadlock/lock-timeout/serialization-failure error carries (a `code` field
// `response.repository.ts`'s `rejectionReasonFor` does not classify as
// 23503/23505/22P02/22003), injected via `createFaultInjectingPool` at the
// one query every write path shares: `response_client_cursor`'s
// reorder-guard upsert, inside `applyResponse`'s savepoint. Real 40P01 is
// Postgres's own `deadlock_detected` SQLSTATE.
const UNRECOGNISED_DB_ERROR = Object.assign(new Error("deadlock detected"), {
  code: "40P01",
})

interface UnexpectedErrorProblem {
  type: string
  title: string
  status: number
  retryable: boolean
  capturedAs: string
}

interface FailedWriteRow {
  reason: string
  route: string
  raw_body: string
}

describe("an unrecognised database error on a response write", () => {
  let app: TestApp | undefined = undefined
  let pool: PgPool | undefined = undefined

  beforeAll(async () => {
    app = await createTestApp({
      now: NOW,
      poolFault: {
        matches: (sql) => sql.includes("response_client_cursor"),
        error: UNRECOGNISED_DB_ERROR,
      },
    })
    pool = app.get<PgPool>(REQUEST_POOL)
  })

  afterAll(async () => {
    await app?.close()
  })

  function ready(): { app: TestApp; pool: PgPool } {
    if (!app || !pool) {
      throw new Error("Test app was not initialized")
    }

    return { app, pool }
  }

  async function setup(subject: string): Promise<{
    fixture: WriteFixture
    token: string
  }> {
    const context = ready()
    const student = await provisionStudent(context.app, subject)

    return {
      fixture: await seedWriteFixture(context.pool, student.studentId),
      token: student.token,
    }
  }

  async function assertCaptured(
    capturedAs: string,
    routeSubstring: string,
  ): Promise<void> {
    const context = ready()
    const { rows } = await context.pool.query<FailedWriteRow>(
      `SELECT reason, route, raw_body FROM failed_write WHERE id = $1`,
      [capturedAs],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toBe("db_error:40P01")
    expect(rows[0].route).toContain(routeSubstring)
    expect(rows[0].raw_body.length).toBeGreaterThan(0)
  }

  it("PUT /responses/:questionId -- returns a retryable problem+json 500 and captures the write BEFORE it, instead of AllExceptionsFilter's bare shape", async () => {
    const context = ready()
    const { fixture, token } = await setup(`single-db-error-${randomUUID()}`)

    const response = await request(context.app.http.getHttpServer() as App)
      .put(
        `/api/attempts/${fixture.attemptId}/responses/${fixture.appliedQuestionId}`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-db-error",
        seq: 1,
        selectedChoiceIds: [fixture.choiceIds[0]],
      })

    expect(response.status).toBe(500)
    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    )
    // AllExceptionsFilter's leftovers -- proof this is the wire body from
    // ProblemException, not Nest's own default 500 shape.
    expect(response.body).not.toHaveProperty("error")
    expect(response.body).not.toHaveProperty("statusCode")

    const problem = response.body as UnexpectedErrorProblem
    expect(problem.type).toBe("unexpected_error")
    expect(problem.status).toBe(500)
    expect(problem.retryable).toBe(true)
    expect(typeof problem.capturedAs).toBe("string")

    await assertCaptured(
      problem.capturedAs,
      `/api/attempts/${fixture.attemptId}/responses/${fixture.appliedQuestionId}`,
    )
  })

  it("PATCH /responses -- returns the same shape and captures the whole snapshot", async () => {
    const context = ready()
    const { fixture, token } = await setup(`snapshot-db-error-${randomUUID()}`)

    const response = await request(context.app.http.getHttpServer() as App)
      .patch(`/api/attempts/${fixture.attemptId}/responses`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-db-error",
        responses: [
          {
            questionId: fixture.appliedQuestionId,
            seq: 1,
            selectedChoiceIds: [fixture.choiceIds[0]],
          },
        ],
      })

    expect(response.status).toBe(500)
    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    )

    const problem = response.body as UnexpectedErrorProblem
    expect(problem.type).toBe("unexpected_error")
    expect(problem.retryable).toBe(true)

    await assertCaptured(
      problem.capturedAs,
      `/api/attempts/${fixture.attemptId}/responses`,
    )
  })

  it("POST /submit -- returns the same shape, captures the write, and finalizes NOTHING (the submit transaction rolled back, not just the one item)", async () => {
    const context = ready()
    const { fixture, token } = await setup(`submit-db-error-${randomUUID()}`)

    const response = await request(context.app.http.getHttpServer() as App)
      .post(`/api/attempts/${fixture.attemptId}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-db-error",
        responses: [
          {
            questionId: fixture.appliedQuestionId,
            seq: 1,
            selectedChoiceIds: [fixture.choiceIds[0]],
          },
        ],
      })

    expect(response.status).toBe(500)
    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    )

    const problem = response.body as UnexpectedErrorProblem
    expect(problem.type).toBe("unexpected_error")
    expect(problem.retryable).toBe(true)

    // The load-bearing durability assertion: the capture must survive
    // submit's own rollback -- see `ApplyResponseItemsInput.capturePool`'s
    // doc comment. Without routing the capture through a connection outside
    // submit's transaction, this row would vanish along with everything
    // else `submitAttemptRow` rolled back.
    await assertCaptured(
      problem.capturedAs,
      `/api/attempts/${fixture.attemptId}/submit`,
    )

    const { rows } = await context.pool.query<{ status: string }>(
      `SELECT status FROM attempt WHERE id = $1`,
      [fixture.attemptId],
    )
    expect(rows[0]?.status).toBe("in_progress")
  })
})
