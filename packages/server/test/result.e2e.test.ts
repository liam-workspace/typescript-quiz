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

interface ResultContext {
  fixture: WriteFixture
  token: string
}

describe("GET /api/attempts/:id/result", () => {
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
      throw new Error("Result test app was not initialized")
    }

    return { app, pool }
  }

  async function setup(
    subject = `result-${randomUUID()}`,
  ): Promise<ResultContext> {
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
      `/api/attempts/${randomUUID()}/result`,
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
      `result-intruder-${randomUUID()}`,
    )

    const response = await request(context.app.http.getHttpServer() as App)
      .get(`/api/attempts/${owner.fixture.attemptId}/result`)
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

  it("403s for an unknown attempt instead of inventing a 404", async () => {
    const context = ready()
    const student = await provisionStudent(
      context.app,
      `result-missing-${randomUUID()}`,
    )

    const response = await request(context.app.http.getHttpServer() as App)
      .get(`/api/attempts/${randomUUID()}/result`)
      .set("Authorization", `Bearer ${student.token}`)

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      type: "not_your_attempt",
      status: 403,
    })
  })

  it("409s with still_running for an unsubmitted attempt", async () => {
    const context = ready()
    const { fixture, token } = await setup()

    const response = await request(context.app.http.getHttpServer() as App)
      .get(`/api/attempts/${fixture.attemptId}/result`)
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

  it("200s with the computed score and no answer-key marker", async () => {
    const context = ready()
    const { fixture, token } = await setup()
    const correctChoiceMarker = `CORRECT_CHOICE_${randomUUID()}`
    await context.pool.query("UPDATE choice SET label = $2 WHERE id = $1", [
      fixture.choiceIds[0],
      correctChoiceMarker,
    ])
    await request(context.app.http.getHttpServer() as App)
      .post(`/api/attempts/${fixture.attemptId}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "result-score-device",
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
      .get(`/api/attempts/${fixture.attemptId}/result`)
      .set("Authorization", `Bearer ${token}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      attemptId: fixture.attemptId,
      test: { title: "Response write test", version: 1 },
      status: "submitted",
      submittedAt: NOW.toISOString(),
      elapsedSeconds: 0,
      score: {
        pointsEarned: 1,
        pointsPossible: 2,
        percentage: 50,
        answered: 1,
        unanswered: 1,
        correct: 1,
        incorrect: 0,
        isPersonalBest: true,
        sections: [
          {
            title: "Section",
            type: "reading",
            pointsEarned: 1,
            pointsPossible: 2,
          },
        ],
      },
    })
    expect(
      typeof (response.body as { score: { percentage: unknown } }).score
        .percentage,
    ).toBe("number")
    expect(JSON.stringify(response.body)).not.toContain(correctChoiceMarker)
  })

  it("finalizes a past-deadline attempt on read and returns 200, per the contract", async () => {
    const context = ready()
    const { fixture, token } = await setup()
    await context.pool.query(
      `UPDATE attempt
          SET started_at = $2, expires_at = $3
        WHERE id = $1`,
      [
        fixture.attemptId,
        new Date("2026-08-27T09:00:00.000Z"),
        new Date("2026-08-27T09:59:00.000Z"),
      ],
    )

    const response = await request(context.app.http.getHttpServer() as App)
      .get(`/api/attempts/${fixture.attemptId}/result`)
      .set("Authorization", `Bearer ${token}`)
    const { rows } = await context.pool.query<{
      status: string
      submitted_at: Date | null
    }>("SELECT status, submitted_at FROM attempt WHERE id = $1", [
      fixture.attemptId,
    ])

    // OpenAPI's getResult prose: "An in-progress attempt already past
    // its deadline is finalized by this read and then returned with 200 --
    // the result has just become available, so denying it would be perverse."
    // 409 is StillRunning, and this attempt is not running: its clock ran out.
    // Refusing here means a child whose timed test expired taps to see their
    // score and gets an error instead.
    expect(response.status).toBe(200)

    // Finalized AT the deadline, never at the moment of the late read.
    expect(rows).toEqual([
      {
        status: "expired",
        submitted_at: new Date("2026-08-27T09:59:00.000Z"),
      },
    ])
  })
})
