import type { PgPool } from "@liam-workspace/node-postgres"
import { finalizeAttempt } from "@pp/db"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { createTestApp, type TestApp } from "./helpers/app.js"
import { provisionStudent, seedWriteFixture } from "./helpers/write-fixture.js"

const NOW = new Date("2026-08-27T10:00:00.000Z")
const OLDER = new Date("2026-08-27T09:00:00.000Z")

interface AttemptHistoryBody {
  attempts: Array<{
    id: string
    test: { title: string }
    submittedAt: string
    status: "submitted" | "expired"
    pointsEarned: number
    pointsPossible: number
    percentage: number
    sections: Array<{
      title: string
      type: string
      pointsEarned: number
      pointsPossible: number
    }>
  }>
  nextCursor: string | null
}

function body(response: { body: unknown }): AttemptHistoryBody {
  return response.body as AttemptHistoryBody
}

describe("GET /api/attempts", () => {
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
      throw new Error("History test app was not initialized")
    }

    return { app, pool }
  }

  it("401s with problem+json when no token is supplied", async () => {
    const context = ready()

    const response = await request(context.app.http.getHttpServer() as App).get(
      "/api/attempts",
    )

    expect(response.status).toBe(401)
    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    )
    expect(response.body).toMatchObject({ type: "invalid_token", status: 401 })
  })

  it("200s with only this student's finished attempts, newest first", async () => {
    const context = ready()
    const student = await provisionStudent(
      context.app,
      `history-owner-${randomUUID()}`,
    )
    const other = await provisionStudent(
      context.app,
      `history-other-${randomUUID()}`,
    )

    const submitted = await seedWriteFixture(context.pool, student.studentId)
    const expired = await seedWriteFixture(context.pool, student.studentId)
    const inProgress = await seedWriteFixture(context.pool, student.studentId)
    const somebodyElses = await seedWriteFixture(context.pool, other.studentId)

    await context.pool.query(
      "UPDATE test_version SET title = $2 WHERE id = $1",
      [submitted.versionId, "Newest submitted test"],
    )
    await context.pool.query(
      "UPDATE test_version SET title = $2 WHERE id = $1",
      [expired.versionId, "Older expired test"],
    )
    await context.pool.query(
      `UPDATE attempt
          SET started_at = $2::timestamptz - interval '30 minutes',
              expires_at = $2
        WHERE id = $1`,
      [expired.attemptId, OLDER],
    )

    await finalizeAttempt(context.pool, {
      attemptId: submitted.attemptId,
      status: "submitted",
      submittedAt: NOW,
    })
    await finalizeAttempt(context.pool, {
      attemptId: expired.attemptId,
      status: "expired",
      submittedAt: OLDER,
    })
    await finalizeAttempt(context.pool, {
      attemptId: somebodyElses.attemptId,
      status: "submitted",
      submittedAt: new Date("2026-08-27T11:00:00.000Z"),
    })

    const response = await request(context.app.http.getHttpServer() as App)
      .get("/api/attempts")
      .set("Authorization", `Bearer ${student.token}`)

    expect(response.status).toBe(200)
    expect(body(response)).toEqual({
      attempts: [
        {
          id: submitted.attemptId,
          test: { title: "Newest submitted test" },
          submittedAt: NOW.toISOString(),
          status: "submitted",
          pointsEarned: 0,
          pointsPossible: 2,
          percentage: 0,
          sections: [
            {
              title: "Section",
              type: "reading",
              pointsEarned: 0,
              pointsPossible: 2,
            },
          ],
        },
        {
          id: expired.attemptId,
          test: { title: "Older expired test" },
          submittedAt: OLDER.toISOString(),
          status: "expired",
          pointsEarned: 0,
          pointsPossible: 2,
          percentage: 0,
          sections: [
            {
              title: "Section",
              type: "reading",
              pointsEarned: 0,
              pointsPossible: 2,
            },
          ],
        },
      ],
      nextCursor: null,
    })
    expect(typeof body(response).attempts[0]?.percentage).toBe("number")
    expect(body(response).attempts.map((attempt) => attempt.id)).not.toContain(
      inProgress.attemptId,
    )
    expect(body(response).attempts.map((attempt) => attempt.id)).not.toContain(
      somebodyElses.attemptId,
    )
  })

  it("200s with an empty page for a valid unprovisioned subject", async () => {
    const context = ready()
    const token = await context.app.mint({
      sub: `history-unprovisioned-${randomUUID()}`,
      email: "history@example.com",
    })

    const response = await request(context.app.http.getHttpServer() as App)
      .get("/api/attempts")
      .set("Authorization", `Bearer ${token}`)

    expect(response.status).toBe(200)
    expect(body(response)).toEqual({ attempts: [], nextCursor: null })
  })

  it("400s with problem+json on an undecodable cursor", async () => {
    const context = ready()
    const student = await provisionStudent(
      context.app,
      `history-bad-cursor-${randomUUID()}`,
    )

    const malformedIdCursor = Buffer.from(
      JSON.stringify({ submittedAt: NOW.toISOString(), id: "not-a-uuid" }),
    ).toString("base64url")

    const responses = await Promise.all(
      ["not-a-valid-cursor!!", malformedIdCursor].map((cursor) =>
        request(context.app.http.getHttpServer() as App)
          .get("/api/attempts")
          .query({ cursor })
          .set("Authorization", `Bearer ${student.token}`),
      ),
    )

    for (const response of responses) {
      expect(response.status).toBe(400)
      expect(response.headers["content-type"]).toMatch(
        /^application\/problem\+json/,
      )
      expect(response.body).toMatchObject({ type: "bad_cursor", status: 400 })
    }
  })

  it("400s rather than silently clamping an out-of-range limit", async () => {
    const context = ready()
    const student = await provisionStudent(
      context.app,
      `history-bad-limit-${randomUUID()}`,
    )

    const responses = await Promise.all(
      [0, 51].map((limit) =>
        request(context.app.http.getHttpServer() as App)
          .get("/api/attempts")
          .query({ limit })
          .set("Authorization", `Bearer ${student.token}`),
      ),
    )

    for (const response of responses) {
      expect(response.status).toBe(400)
      expect(response.body).toMatchObject({ type: "bad_limit", status: 400 })
    }
  })
})
