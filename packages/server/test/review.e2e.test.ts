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

interface ReviewContext {
  fixture: WriteFixture
  token: string
}

describe("GET /api/attempts/:id/review", () => {
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
      throw new Error("Review test app was not initialized")
    }

    return { app, pool }
  }

  async function setup(
    subject = `review-${randomUUID()}`,
  ): Promise<ReviewContext> {
    const context = ready()
    const student = await provisionStudent(context.app, subject)

    return {
      fixture: await seedWriteFixture(context.pool, student.studentId),
      token: student.token,
    }
  }

  it("401s with problem+json when no token is supplied", async () => {
    const context = ready()

    const response = await request(context.app.http.getHttpServer() as App).get(
      `/api/attempts/${randomUUID()}/review`,
    )

    expect(response.status).toBe(401)
    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    )
    expect(response.body).toMatchObject({ type: "invalid_token", status: 401 })
  })

  it("403s for another student's attempt", async () => {
    const context = ready()
    const owner = await setup()
    const intruder = await provisionStudent(
      context.app,
      `review-intruder-${randomUUID()}`,
    )

    const response = await request(context.app.http.getHttpServer() as App)
      .get(`/api/attempts/${owner.fixture.attemptId}/review`)
      .set("Authorization", `Bearer ${intruder.token}`)

    expect(response.status).toBe(403)
    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    )
    expect(response.body).toMatchObject({
      type: "not_your_attempt",
      status: 403,
    })
  })

  it("409s with still_running for a genuinely running attempt", async () => {
    const context = ready()
    const { fixture, token } = await setup()

    const response = await request(context.app.http.getHttpServer() as App)
      .get(`/api/attempts/${fixture.attemptId}/review`)
      .set("Authorization", `Bearer ${token}`)

    expect(response.status).toBe(409)
    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    )
    expect(response.body).toEqual({
      type: "still_running",
      title: "Attempt still running",
      status: 409,
      retryable: false,
    })
  })

  it("200s with every question and its answer key, including an unanswered one", async () => {
    const context = ready()
    const { fixture, token } = await setup()

    await request(context.app.http.getHttpServer() as App)
      .post(`/api/attempts/${fixture.attemptId}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "review-device",
        responses: [
          {
            questionId: fixture.appliedQuestionId,
            seq: 1,
            selectedChoiceIds: [fixture.choiceIds[0]],
          },
        ],
      })
      .expect(201)

    const response = await request(context.app.http.getHttpServer() as App)
      .get(`/api/attempts/${fixture.attemptId}/review`)
      .set("Authorization", `Bearer ${token}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      attemptId: fixture.attemptId,
      items: [
        {
          questionId: fixture.appliedQuestionId,
          ordinal: 1,
          sectionId: fixture.sectionId,
          prompt: "Applied?",
          outcome: "correct",
          choices: [
            {
              id: fixture.choiceIds[0],
              label: "A",
              isCorrect: true,
              selected: true,
            },
            {
              id: fixture.choiceIds[1],
              label: "B",
              isCorrect: false,
              selected: false,
            },
          ],
        },
        {
          questionId: fixture.staleQuestionId,
          ordinal: 2,
          sectionId: fixture.sectionId,
          prompt: "Stale?",
          outcome: "unanswered",
          choices: [
            {
              id: fixture.choiceIds[2],
              label: "C",
              isCorrect: true,
              selected: false,
            },
            {
              id: fixture.choiceIds[3],
              label: "D",
              isCorrect: false,
              selected: false,
            },
          ],
        },
      ],
    })
    expect(
      typeof (response.body as { items: [{ ordinal: unknown }] }).items[0]
        .ordinal,
    ).toBe("number")
  })

  it("finalizes a past-deadline attempt on read and returns its review", async () => {
    const context = ready()
    const { fixture, token } = await setup()
    const deadline = new Date("2026-08-27T09:59:00.000Z")
    await context.pool.query(
      `UPDATE attempt
          SET started_at = $2, expires_at = $3
        WHERE id = $1`,
      [fixture.attemptId, new Date("2026-08-27T09:00:00.000Z"), deadline],
    )

    const response = await request(context.app.http.getHttpServer() as App)
      .get(`/api/attempts/${fixture.attemptId}/review`)
      .set("Authorization", `Bearer ${token}`)
    const { rows } = await context.pool.query<{
      status: string
      submitted_at: Date | null
    }>("SELECT status, submitted_at FROM attempt WHERE id = $1", [
      fixture.attemptId,
    ])

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      attemptId: fixture.attemptId,
      items: [{ outcome: "unanswered" }, { outcome: "unanswered" }],
    })
    expect(rows).toEqual([{ status: "expired", submitted_at: deadline }])
  })
})
