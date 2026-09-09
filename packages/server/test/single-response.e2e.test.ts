import type { PgPool } from "@liam-workspace/node-postgres"
import { loadResponse } from "@pp/db"
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

describe("PUT /attempts/:id/responses/:questionId", () => {
  let app: TestApp | undefined = undefined
  let pool: PgPool | undefined = undefined
  let fixture: WriteFixture | undefined = undefined
  let token = ""

  beforeAll(async () => {
    app = await createTestApp({ now: NOW })
    pool = app.get<PgPool>(REQUEST_POOL)
    const { studentId, token: provisionedToken } = await provisionStudent(
      app,
      `single-response-${randomUUID()}`,
    )
    token = provisionedToken
    fixture = await seedWriteFixture(pool, studentId)
  })

  afterAll(async () => {
    await app?.close()
  })

  function ready(): { app: TestApp; pool: PgPool; fixture: WriteFixture } {
    if (!app || !pool || !fixture) {
      throw new Error("Single-response fixture was not initialized")
    }

    return { app, pool, fixture }
  }

  it("applies a valid write and stores the acknowledged answer", async () => {
    const context = ready()

    const response = await request(context.app.http.getHttpServer() as App)
      .put(
        `/api/attempts/${context.fixture.attemptId}/responses/${context.fixture.appliedQuestionId}`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-applied",
        seq: 1,
        selectedChoiceIds: [context.fixture.choiceIds[0]],
      })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      questionId: context.fixture.appliedQuestionId,
      status: "applied",
      attempt: {
        expiresAt: null,
        sectionExpiresAt: null,
        serverTime: "2026-08-27T10:00:00.000Z",
      },
    })

    const stored = await loadResponse(context.pool, {
      attemptId: context.fixture.attemptId,
      questionId: context.fixture.appliedQuestionId,
    })
    expect(stored).toEqual({
      clientInstanceId: "device-applied",
      seq: 1,
      selectedChoiceIds: [context.fixture.choiceIds[0]],
    })
    expect(typeof stored?.seq).toBe("number")
  })

  it("200s a stale write without replacing the winning answer", async () => {
    const context = ready()
    const url = `/api/attempts/${context.fixture.attemptId}/responses/${context.fixture.staleQuestionId}`

    const winner = await request(context.app.http.getHttpServer() as App)
      .put(url)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-stale",
        seq: 50,
        selectedChoiceIds: [context.fixture.choiceIds[2]],
      })
    expect(winner.status).toBe(200)
    expect((winner.body as { status: unknown }).status).toBe("applied")

    const stale = await request(context.app.http.getHttpServer() as App)
      .put(url)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-stale",
        seq: 1,
        selectedChoiceIds: [context.fixture.choiceIds[3]],
      })

    expect(stale.status).toBe(200)
    expect((stale.body as { status: unknown }).status).toBe("ignored_stale")

    const stored = await loadResponse(context.pool, {
      attemptId: context.fixture.attemptId,
      questionId: context.fixture.staleQuestionId,
    })
    expect(stored).toEqual({
      clientInstanceId: "device-stale",
      seq: 50,
      selectedChoiceIds: [context.fixture.choiceIds[2]],
    })
    expect(typeof stored?.seq).toBe("number")
  })

  it("409s and captures a forbidden answer change without replacing the first answer", async () => {
    const context = ready()
    const provisioned = await provisionStudent(
      context.app,
      `single-response-locked-${randomUUID()}`,
    )
    const locked = await seedWriteFixture(context.pool, provisioned.studentId, {
      navigation: "forward_only",
      allowAnswerChange: false,
      sectionType: "listening",
    })
    const url = `/api/attempts/${locked.attemptId}/responses/${locked.appliedQuestionId}`

    await request(context.app.http.getHttpServer() as App)
      .put(url)
      .set("Authorization", `Bearer ${provisioned.token}`)
      .send({
        clientInstanceId: "device-locked",
        seq: 1,
        selectedChoiceIds: [locked.choiceIds[0]],
      })
      .expect(200)

    const rejectedBody = JSON.stringify({
      clientInstanceId: "device-locked",
      seq: 2,
      selectedChoiceIds: [locked.choiceIds[1]],
    })
    const rejected = await request(context.app.http.getHttpServer() as App)
      .put(url)
      .set("Authorization", `Bearer ${provisioned.token}`)
      .set("Content-Type", "application/json")
      .send(rejectedBody)

    expect(rejected.status).toBe(409)
    expect(rejected.body).toMatchObject({
      type: "answer_change_not_allowed",
      status: 409,
      retryable: false,
    })
    const { capturedAs } = rejected.body as { capturedAs: unknown }
    expect(typeof capturedAs).toBe("string")

    if (typeof capturedAs !== "string") {
      throw new Error("The rejection did not name its failed_write capture")
    }

    const { rows } = await context.pool.query<{
      raw_body: string
      byte_size: number | null
      reason: string
      client_instance_id: string | null
    }>(
      `SELECT raw_body, byte_size, reason, client_instance_id
         FROM failed_write WHERE id = $1`,
      [capturedAs],
    )
    expect(rows).toEqual([
      {
        raw_body: rejectedBody,
        byte_size: Buffer.byteLength(rejectedBody),
        reason: "answer_change_not_allowed",
        client_instance_id: "device-locked",
      },
    ])

    expect(
      await loadResponse(context.pool, {
        attemptId: locked.attemptId,
        questionId: locked.appliedQuestionId,
      }),
    ).toEqual({
      clientInstanceId: "device-locked",
      seq: 1,
      selectedChoiceIds: [locked.choiceIds[0]],
    })
  })

  it("409s and captures a response to an earlier forward-only question", async () => {
    const context = ready()
    const provisioned = await provisionStudent(
      context.app,
      `single-response-navigation-${randomUUID()}`,
    )
    const locked = await seedWriteFixture(context.pool, provisioned.studentId, {
      navigation: "forward_only",
      allowAnswerChange: true,
    })
    await context.pool.query(
      `UPDATE attempt
          SET current_section_id = $2, current_question_id = $3
        WHERE id = $1`,
      [locked.attemptId, locked.sectionId, locked.staleQuestionId],
    )

    const body = JSON.stringify({
      clientInstanceId: "device-navigation",
      seq: 1,
      selectedChoiceIds: [locked.choiceIds[0]],
    })
    const response = await request(context.app.http.getHttpServer() as App)
      .put(
        `/api/attempts/${locked.attemptId}/responses/${locked.appliedQuestionId}`,
      )
      .set("Authorization", `Bearer ${provisioned.token}`)
      .set("Content-Type", "application/json")
      .send(body)

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({
      type: "navigation_locked",
      status: 409,
      retryable: false,
    })
    const { capturedAs } = response.body as { capturedAs: unknown }
    expect(typeof capturedAs).toBe("string")
    expect(
      await loadResponse(context.pool, {
        attemptId: locked.attemptId,
        questionId: locked.appliedQuestionId,
      }),
    ).toBeNull()
  })

  it("410s after the question's section deadline without storing the response", async () => {
    const context = ready()
    const provisioned = await provisionStudent(
      context.app,
      `single-response-section-expired-${randomUUID()}`,
    )
    const expired = await seedWriteFixture(context.pool, provisioned.studentId)
    await context.pool.query(
      `UPDATE attempt
          SET started_at = $2, expires_at = $3,
              current_section_id = $4, current_question_id = $5
        WHERE id = $1`,
      [
        expired.attemptId,
        new Date("2026-08-27T08:00:00.000Z"),
        new Date("2026-08-27T12:00:00.000Z"),
        expired.sectionId,
        expired.appliedQuestionId,
      ],
    )
    await context.pool.query(
      `INSERT INTO attempt_section
         (attempt_id, test_section_id, test_version_id, entered_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        expired.attemptId,
        expired.sectionId,
        expired.versionId,
        new Date("2026-08-27T08:00:00.000Z"),
        new Date("2026-08-27T09:00:00.000Z"),
      ],
    )

    const response = await request(context.app.http.getHttpServer() as App)
      .put(
        `/api/attempts/${expired.attemptId}/responses/${expired.appliedQuestionId}`,
      )
      .set("Authorization", `Bearer ${provisioned.token}`)
      .send({
        clientInstanceId: "device-section-expired",
        seq: 1,
        selectedChoiceIds: [expired.choiceIds[0]],
      })

    expect(response.status).toBe(410)
    expect(response.body).toEqual({
      type: "section_expired",
      title: "The section's clock ran out.",
      status: 410,
      retryable: false,
    })
    expect(
      await loadResponse(context.pool, {
        attemptId: expired.attemptId,
        questionId: expired.appliedQuestionId,
      }),
    ).toBeNull()
  })

  it("410s and finalizes an attempt past its deadline", async () => {
    const context = ready()
    const provisioned = await provisionStudent(
      context.app,
      `single-response-attempt-expired-${randomUUID()}`,
    )
    const expired = await seedWriteFixture(context.pool, provisioned.studentId)
    await context.pool.query(
      `UPDATE attempt SET started_at = $2, expires_at = $3 WHERE id = $1`,
      [
        expired.attemptId,
        new Date("2026-08-27T08:00:00.000Z"),
        new Date("2026-08-27T09:00:00.000Z"),
      ],
    )

    const response = await request(context.app.http.getHttpServer() as App)
      .put(
        `/api/attempts/${expired.attemptId}/responses/${expired.appliedQuestionId}`,
      )
      .set("Authorization", `Bearer ${provisioned.token}`)
      .send({
        clientInstanceId: "device-attempt-expired",
        seq: 1,
        selectedChoiceIds: [expired.choiceIds[0]],
      })

    expect(response.status).toBe(410)
    expect(response.body).toEqual({
      type: "attempt_expired",
      title: "The attempt was past its deadline and has been finalized.",
      status: 410,
      retryable: false,
      attempt: {
        id: expired.attemptId,
        status: "expired",
        submittedAt: "2026-08-27T09:00:00.000Z",
        resultUrl: `/attempts/${expired.attemptId}/result`,
      },
    })

    const { rows } = await context.pool.query<{
      status: string
      submitted_at: Date
    }>("SELECT status, submitted_at FROM attempt WHERE id = $1", [
      expired.attemptId,
    ])
    expect(rows).toEqual([
      {
        status: "expired",
        submitted_at: new Date("2026-08-27T09:00:00.000Z"),
      },
    ])
  })

  it("401s without a bearer token", async () => {
    const context = ready()

    await request(context.app.http.getHttpServer() as App)
      .put(
        `/api/attempts/${context.fixture.attemptId}/responses/${context.fixture.appliedQuestionId}`,
      )
      .send({
        clientInstanceId: "device-unauthorized",
        seq: 2,
        selectedChoiceIds: [],
      })
      .expect(401)
  })

  it("403s for a provisioned student who does not own the attempt", async () => {
    const context = ready()
    const other = await provisionStudent(
      context.app,
      `single-response-other-${randomUUID()}`,
    )

    const response = await request(context.app.http.getHttpServer() as App)
      .put(
        `/api/attempts/${context.fixture.attemptId}/responses/${context.fixture.appliedQuestionId}`,
      )
      .set("Authorization", `Bearer ${other.token}`)
      .send({
        clientInstanceId: "device-other",
        seq: 2,
        selectedChoiceIds: [],
      })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      type: "not_your_attempt",
      status: 403,
    })
  })
})
