import type { PgPool } from "@liam-workspace/node-postgres"
import { loadResponse, writeResponse } from "@pp/db"
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

interface SubmitContext {
  fixture: WriteFixture
  token: string
}

interface SubmitBody {
  attemptId: string
  status: "submitted"
  submittedAt: string
  resultUrl: string
  finalFlush: Array<Record<string, unknown>>
}

describe("POST /api/attempts/:id/submit", () => {
  let app: TestApp | undefined = undefined
  let pool: PgPool | undefined = undefined

  beforeAll(async () => {
    app = await createTestApp({ now: NOW })
    pool = app.get<PgPool>(REQUEST_POOL)
  })

  afterAll(async () => {
    await app?.close()
  })

  function ready(): { app: TestApp; pool: PgPool } {
    if (!app || !pool) {
      throw new Error("Submit test app was not initialized")
    }

    return { app, pool }
  }

  async function setup(
    subject = `submit-${randomUUID()}`,
  ): Promise<SubmitContext> {
    const context = ready()
    const student = await provisionStudent(context.app, subject)

    return {
      fixture: await seedWriteFixture(context.pool, student.studentId),
      token: student.token,
    }
  }

  it("401s with a problem+json body when no token is supplied", async () => {
    const context = ready()

    const response = await request(context.app.http.getHttpServer() as App)
      .post(`/api/attempts/${randomUUID()}/submit`)
      .send({ clientInstanceId: "anonymous-device" })

    expect(response.status).toBe(401)
    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    )
    expect(response.body).toMatchObject({
      type: "invalid_token",
      status: 401,
    })
  })

  it("403s when the attempt belongs to another student", async () => {
    const context = ready()
    const owner = await setup()
    const intruder = await provisionStudent(
      context.app,
      `submit-intruder-${randomUUID()}`,
    )

    const response = await request(context.app.http.getHttpServer() as App)
      .post(`/api/attempts/${owner.fixture.attemptId}/submit`)
      .set("Authorization", `Bearer ${intruder.token}`)
      .send({ clientInstanceId: "intruder-device" })

    expect(response.status).toBe(403)
    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    )
    expect(response.body).toMatchObject({
      type: "not_your_attempt",
      status: 403,
    })
  })

  it("applies the only answer before grading, then returns 200 with the identical finalized row", async () => {
    const context = ready()
    const { fixture, token } = await setup()
    const firstRequest = {
      clientInstanceId: "submit-score-device",
      responses: [
        {
          questionId: fixture.appliedQuestionId,
          seq: 1,
          selectedChoiceIds: [fixture.choiceIds[0]],
        },
      ],
    }

    const first = await request(context.app.http.getHttpServer() as App)
      .post(`/api/attempts/${fixture.attemptId}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send(firstRequest)

    expect(first.status).toBe(201)
    expect(first.body).toEqual({
      attemptId: fixture.attemptId,
      status: "submitted",
      submittedAt: NOW.toISOString(),
      resultUrl: `/attempts/${fixture.attemptId}/result`,
      finalFlush: [
        { questionId: fixture.appliedQuestionId, status: "applied" },
      ],
    })
    const firstRow = await context.pool.query<{
      status: string
      submitted_at: Date
      points_earned: number
      answered_count: number
    }>(
      `SELECT status, submitted_at, points_earned, answered_count
         FROM attempt WHERE id = $1`,
      [fixture.attemptId],
    )
    expect(firstRow.rows).toEqual([
      {
        status: "submitted",
        submitted_at: NOW,
        points_earned: 1,
        answered_count: 1,
      },
    ])

    const second = await request(context.app.http.getHttpServer() as App)
      .post(`/api/attempts/${fixture.attemptId}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "submit-score-device",
        responses: [
          {
            questionId: fixture.appliedQuestionId,
            seq: 2,
            selectedChoiceIds: [fixture.choiceIds[1]],
          },
        ],
      })

    expect(second.status).toBe(200)
    expect(second.body).toEqual({
      ...(first.body as SubmitBody),
      finalFlush: [],
    })
    const secondRow = await context.pool.query<{
      status: string
      submitted_at: Date
      points_earned: number
      answered_count: number
    }>(
      `SELECT status, submitted_at, points_earned, answered_count
         FROM attempt WHERE id = $1`,
      [fixture.attemptId],
    )
    expect(secondRow.rows).toEqual(firstRow.rows)
    expect(
      await loadResponse(context.pool, {
        attemptId: fixture.attemptId,
        questionId: fixture.appliedQuestionId,
      }),
    ).toMatchObject({ selectedChoiceIds: [fixture.choiceIds[0]], seq: 1 })
  })

  it("409s with nothing_answered and leaves the attempt in progress", async () => {
    const context = ready()
    const { fixture, token } = await setup()

    const response = await request(context.app.http.getHttpServer() as App)
      .post(`/api/attempts/${fixture.attemptId}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ clientInstanceId: "empty-submit-device", responses: [] })

    expect(response.status).toBe(409)
    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    )
    expect(response.body).toMatchObject({
      type: "nothing_answered",
      status: 409,
      retryable: false,
    })
    const { rows } = await context.pool.query<{ status: string }>(
      "SELECT status FROM attempt WHERE id = $1",
      [fixture.attemptId],
    )
    expect(rows[0]?.status).toBe("in_progress")
  })

  it("410s and pins an expired attempt to its deadline", async () => {
    const context = ready()
    const { fixture, token } = await setup()
    const expiresAtForWire = "2026-08-27T09:59:59.123Z"
    await context.pool.query(
      `UPDATE attempt
          SET started_at = $2,
              expires_at = TIMESTAMPTZ '2026-08-27 09:59:59.123456+00'
        WHERE id = $1`,
      [fixture.attemptId, new Date("2026-08-27T09:00:00.000Z")],
    )

    const response = await request(context.app.http.getHttpServer() as App)
      .post(`/api/attempts/${fixture.attemptId}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ clientInstanceId: "late-submit-device" })

    expect(response.status).toBe(410)
    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    )
    expect(response.body).toEqual({
      type: "attempt_expired",
      title: "The attempt was past its deadline and has been finalized.",
      status: 410,
      retryable: false,
      attempt: {
        id: fixture.attemptId,
        status: "expired",
        submittedAt: expiresAtForWire,
        resultUrl: `/attempts/${fixture.attemptId}/result`,
      },
    })
    const { rows } = await context.pool.query<{
      submitted_matches_deadline: boolean
    }>(
      `SELECT submitted_at = expires_at AS submitted_matches_deadline
         FROM attempt WHERE id = $1`,
      [fixture.attemptId],
    )
    expect(rows[0]?.submitted_matches_deadline).toBe(true)
  })

  it("treats a stale remainder item as a successful acknowledgement", async () => {
    const context = ready()
    const { fixture, token } = await setup()
    await writeResponse(context.pool, {
      attemptId: fixture.attemptId,
      questionId: fixture.staleQuestionId,
      testVersionId: fixture.versionId,
      clientInstanceId: "stale-submit-device",
      seq: 7,
      selectedChoiceIds: [fixture.choiceIds[2]],
      answeredAt: NOW,
      timeSpentMs: null,
      allowAnswerChange: true,
      now: NOW,
    })

    const response = await request(context.app.http.getHttpServer() as App)
      .post(`/api/attempts/${fixture.attemptId}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "stale-submit-device",
        responses: [
          {
            questionId: fixture.staleQuestionId,
            seq: 7,
            selectedChoiceIds: [fixture.choiceIds[3]],
          },
        ],
      })

    expect(response.status).toBe(201)
    expect((response.body as SubmitBody).finalFlush).toEqual([
      { questionId: fixture.staleQuestionId, status: "ignored_stale" },
    ])
  })

  it("captures a terminal item rejection and still finalizes an already-answered attempt", async () => {
    const context = ready()
    const { fixture, token } = await setup()
    await writeResponse(context.pool, {
      attemptId: fixture.attemptId,
      questionId: fixture.appliedQuestionId,
      testVersionId: fixture.versionId,
      clientInstanceId: "prior-answer-device",
      seq: 1,
      selectedChoiceIds: [fixture.choiceIds[0]],
      answeredAt: NOW,
      timeSpentMs: null,
      allowAnswerChange: true,
      now: NOW,
    })

    const response = await request(context.app.http.getHttpServer() as App)
      .post(`/api/attempts/${fixture.attemptId}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "rejected-submit-device",
        responses: [
          {
            questionId: fixture.staleQuestionId,
            seq: 1,
            selectedChoiceIds: [randomUUID()],
          },
        ],
      })

    expect(response.status).toBe(201)
    const [item] = (response.body as SubmitBody).finalFlush
    expect(item).toMatchObject({
      questionId: fixture.staleQuestionId,
      status: "rejected",
      reason: "invalid",
      retryable: false,
    })
    expect(typeof item.capturedAs).toBe("string")
    const capture = await context.pool.query<{ reason: string }>(
      "SELECT reason FROM failed_write WHERE id = $1",
      [item.capturedAs],
    )
    expect(capture.rows).toEqual([{ reason: "invalid" }])
  })

  it("400s and captures a body missing clientInstanceId", async () => {
    const context = ready()
    const { fixture, token } = await setup()

    const response = await request(context.app.http.getHttpServer() as App)
      .post(`/api/attempts/${fixture.attemptId}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ responses: [] })

    expect(response.status).toBe(400)
    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    )
    expect(response.body).toMatchObject({
      type: "invalid_body",
      status: 400,
      retryable: false,
    })
    expect(typeof (response.body as { capturedAs?: unknown }).capturedAs).toBe(
      "string",
    )
  })

  it("413s and captures an oversized submit body", async () => {
    const context = ready()

    const response = await request(context.app.http.getHttpServer() as App)
      .post(`/api/attempts/${randomUUID()}/submit`)
      .send({ clientInstanceId: "x".repeat(270_000) })

    expect(response.status).toBe(413)
    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    )
    expect(response.body).toMatchObject({
      type: "payload_too_large",
      status: 413,
      retryable: false,
    })
    expect(typeof (response.body as { capturedAs?: unknown }).capturedAs).toBe(
      "string",
    )
  })
})
