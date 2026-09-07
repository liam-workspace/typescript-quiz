import type { PgPool } from "@liam-public/node-postgres"
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
  type SeedWriteFixtureOptions,
  type WriteFixture,
} from "./helpers/write-fixture.js"

const NOW = new Date("2026-08-27T10:00:00.000Z")

interface SnapshotContext {
  fixture: WriteFixture
  token: string
}

interface SnapshotResponseBody {
  results: Array<Record<string, unknown>>
}

interface CapturedErrorBody {
  capturedAs: unknown
}

describe("PATCH /attempts/:id/responses", () => {
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
      throw new Error("Response-snapshot app was not initialized")
    }

    return { app, pool }
  }

  async function setup(
    options: SeedWriteFixtureOptions = {},
  ): Promise<SnapshotContext> {
    const context = ready()
    const student = await provisionStudent(
      context.app,
      `response-snapshot-${randomUUID()}`,
    )

    return {
      fixture: await seedWriteFixture(context.pool, student.studentId, options),
      token: student.token,
    }
  }

  it("applies every item in the section snapshot and stores its content", async () => {
    const context = ready()
    const { fixture, token } = await setup()

    const response = await request(context.app.http.getHttpServer() as App)
      .patch(`/api/attempts/${fixture.attemptId}/responses`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-full",
        responses: [
          {
            questionId: fixture.appliedQuestionId,
            seq: 1,
            selectedChoiceIds: [fixture.choiceIds[1]],
          },
          {
            questionId: fixture.staleQuestionId,
            seq: 2,
            selectedChoiceIds: [fixture.choiceIds[2]],
          },
        ],
      })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      results: [
        { questionId: fixture.appliedQuestionId, status: "applied" },
        { questionId: fixture.staleQuestionId, status: "applied" },
      ],
      attempt: {
        expiresAt: null,
        sectionExpiresAt: null,
        serverTime: "2026-08-27T10:00:00.000Z",
      },
    })
    expect(
      await loadResponse(context.pool, {
        attemptId: fixture.attemptId,
        questionId: fixture.appliedQuestionId,
      }),
    ).toEqual({
      clientInstanceId: "device-full",
      seq: 1,
      selectedChoiceIds: [fixture.choiceIds[1]],
    })
    expect(
      await loadResponse(context.pool, {
        attemptId: fixture.attemptId,
        questionId: fixture.staleQuestionId,
      }),
    ).toEqual({
      clientInstanceId: "device-full",
      seq: 2,
      selectedChoiceIds: [fixture.choiceIds[2]],
    })
  })

  it("stores a valid item beside an unknown question and captures the rejected item", async () => {
    const context = ready()
    const { fixture, token } = await setup()
    const unknownQuestionId = "00000000-0000-0000-0000-000000000000"
    const rejectedItem = {
      questionId: unknownQuestionId,
      seq: 1,
      selectedChoiceIds: [] as string[],
    }

    const response = await request(context.app.http.getHttpServer() as App)
      .patch(`/api/attempts/${fixture.attemptId}/responses`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Client-Version", "snapshot-test")
      .send({
        clientInstanceId: "device-isolated",
        responses: [
          {
            questionId: fixture.appliedQuestionId,
            seq: 10,
            selectedChoiceIds: [fixture.choiceIds[1]],
          },
          rejectedItem,
        ],
      })

    expect(response.status).toBe(200)
    const { results } = response.body as SnapshotResponseBody
    expect(results[0]).toEqual({
      questionId: fixture.appliedQuestionId,
      status: "applied",
    })
    expect(results[1]).toMatchObject({
      questionId: unknownQuestionId,
      status: "rejected",
      reason: "unknown_question",
      retryable: false,
    })
    expect(typeof results[1]?.capturedAs).toBe("string")

    expect(
      await loadResponse(context.pool, {
        attemptId: fixture.attemptId,
        questionId: fixture.appliedQuestionId,
      }),
    ).toEqual({
      clientInstanceId: "device-isolated",
      seq: 10,
      selectedChoiceIds: [fixture.choiceIds[1]],
    })

    const { rows } = await context.pool.query<{
      raw_body: string
      byte_size: number | null
      client_instance_id: string | null
      client_version: string | null
    }>(
      `SELECT raw_body, byte_size, client_instance_id, client_version
         FROM failed_write WHERE id = $1`,
      [results[1]?.capturedAs],
    )
    const serializedItem = JSON.stringify(rejectedItem)
    expect(rows).toEqual([
      {
        raw_body: serializedItem,
        byte_size: Buffer.byteLength(serializedItem),
        client_instance_id: "device-isolated",
        client_version: "snapshot-test",
      },
    ])
  })

  it("rejects malformed items individually and still stores a later valid sibling", async () => {
    const context = ready()
    const { fixture, token } = await setup()
    const malformedQuestion = {
      questionId: "not-a-uuid",
      seq: 1,
      selectedChoiceIds: [] as string[],
    }
    const malformedSequence = {
      questionId: fixture.appliedQuestionId,
      seq: "not-a-number",
      selectedChoiceIds: [fixture.choiceIds[0]],
    }

    const response = await request(context.app.http.getHttpServer() as App)
      .patch(`/api/attempts/${fixture.attemptId}/responses`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-invalid-items",
        responses: [
          malformedQuestion,
          malformedSequence,
          {
            questionId: fixture.staleQuestionId,
            seq: 3,
            selectedChoiceIds: [fixture.choiceIds[3]],
          },
        ],
      })

    expect(response.status).toBe(200)
    const { results } = response.body as SnapshotResponseBody

    expect(results).toHaveLength(3)
    expect(results[0]).toMatchObject({
      questionId: "not-a-uuid",
      status: "rejected",
      reason: "invalid",
      retryable: false,
    })
    expect(typeof results[0]?.capturedAs).toBe("string")
    expect(results[1]).toMatchObject({
      questionId: fixture.appliedQuestionId,
      status: "rejected",
      reason: "invalid",
      retryable: false,
    })
    expect(typeof results[1]?.capturedAs).toBe("string")
    expect(results[2]).toEqual({
      questionId: fixture.staleQuestionId,
      status: "applied",
    })
    expect(
      await loadResponse(context.pool, {
        attemptId: fixture.attemptId,
        questionId: fixture.staleQuestionId,
      }),
    ).toEqual({
      clientInstanceId: "device-invalid-items",
      seq: 3,
      selectedChoiceIds: [fixture.choiceIds[3]],
    })

    const { rows } = await context.pool.query<{ raw_body: string }>(
      `SELECT raw_body FROM failed_write WHERE id = ANY($1::uuid[])
       ORDER BY raw_body`,
      [[results[0]?.capturedAs, results[1]?.capturedAs]],
    )

    expect(rows).toEqual(
      [malformedQuestion, malformedSequence]
        .map((item) => ({ raw_body: JSON.stringify(item) }))
        .sort((left, right) => left.raw_body.localeCompare(right.raw_body)),
    )
  })

  it("keeps processing after a choice from another question poisons one item", async () => {
    const context = ready()
    const { fixture, token } = await setup()

    const response = await request(context.app.http.getHttpServer() as App)
      .patch(`/api/attempts/${fixture.attemptId}/responses`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-choice-isolation",
        responses: [
          {
            questionId: fixture.appliedQuestionId,
            seq: 1,
            selectedChoiceIds: [fixture.choiceIds[2]],
          },
          {
            questionId: fixture.staleQuestionId,
            seq: 2,
            selectedChoiceIds: [fixture.choiceIds[3]],
          },
        ],
      })

    expect(response.status).toBe(200)
    const { results } = response.body as SnapshotResponseBody

    expect(results[0]).toMatchObject({
      questionId: fixture.appliedQuestionId,
      status: "rejected",
      reason: "invalid",
      retryable: false,
    })
    expect(typeof results[0]?.capturedAs).toBe("string")
    expect(results[1]).toEqual({
      questionId: fixture.staleQuestionId,
      status: "applied",
    })
    expect(
      await loadResponse(context.pool, {
        attemptId: fixture.attemptId,
        questionId: fixture.staleQuestionId,
      }),
    ).toEqual({
      clientInstanceId: "device-choice-isolation",
      seq: 2,
      selectedChoiceIds: [fixture.choiceIds[3]],
    })
  })

  it("reports a stale item as success while applying its sibling", async () => {
    const context = ready()
    const { fixture, token } = await setup()
    const url = `/api/attempts/${fixture.attemptId}/responses`

    await request(context.app.http.getHttpServer() as App)
      .patch(url)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-stale-snapshot",
        responses: [
          {
            questionId: fixture.appliedQuestionId,
            seq: 50,
            selectedChoiceIds: [fixture.choiceIds[0]],
          },
        ],
      })
      .expect(200)

    const response = await request(context.app.http.getHttpServer() as App)
      .patch(url)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-stale-snapshot",
        responses: [
          {
            questionId: fixture.appliedQuestionId,
            seq: 1,
            selectedChoiceIds: [fixture.choiceIds[1]],
          },
          {
            questionId: fixture.staleQuestionId,
            seq: 2,
            selectedChoiceIds: [fixture.choiceIds[2]],
          },
        ],
      })

    expect(response.status).toBe(200)
    const { results } = response.body as SnapshotResponseBody

    expect(results).toEqual([
      {
        questionId: fixture.appliedQuestionId,
        status: "ignored_stale",
      },
      { questionId: fixture.staleQuestionId, status: "applied" },
    ])
    expect(
      await loadResponse(context.pool, {
        attemptId: fixture.attemptId,
        questionId: fixture.appliedQuestionId,
      }),
    ).toEqual({
      clientInstanceId: "device-stale-snapshot",
      seq: 50,
      selectedChoiceIds: [fixture.choiceIds[0]],
    })
    expect(
      await loadResponse(context.pool, {
        attemptId: fixture.attemptId,
        questionId: fixture.staleQuestionId,
      }),
    ).toEqual({
      clientInstanceId: "device-stale-snapshot",
      seq: 2,
      selectedChoiceIds: [fixture.choiceIds[2]],
    })
  })

  it("isolates an answer-change rejection from an accepted sibling", async () => {
    const context = ready()
    const { fixture, token } = await setup({
      allowAnswerChange: false,
      navigation: "forward_only",
      sectionType: "listening",
    })
    const url = `/api/attempts/${fixture.attemptId}/responses`

    await request(context.app.http.getHttpServer() as App)
      .patch(url)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-no-change",
        responses: [
          {
            questionId: fixture.appliedQuestionId,
            seq: 1,
            selectedChoiceIds: [fixture.choiceIds[0]],
          },
          {
            questionId: fixture.staleQuestionId,
            seq: 2,
            selectedChoiceIds: [fixture.choiceIds[2]],
          },
        ],
      })
      .expect(200)

    const response = await request(context.app.http.getHttpServer() as App)
      .patch(url)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-no-change",
        responses: [
          {
            questionId: fixture.appliedQuestionId,
            seq: 3,
            selectedChoiceIds: [fixture.choiceIds[1]],
          },
          {
            questionId: fixture.staleQuestionId,
            seq: 4,
            selectedChoiceIds: [fixture.choiceIds[2]],
          },
        ],
      })

    expect(response.status).toBe(200)
    const { results } = response.body as SnapshotResponseBody

    expect(results[0]).toMatchObject({
      questionId: fixture.appliedQuestionId,
      status: "rejected",
      reason: "answer_change_not_allowed",
      retryable: false,
    })
    expect(results[1]).toEqual({
      questionId: fixture.staleQuestionId,
      status: "applied",
    })
    expect(
      await loadResponse(context.pool, {
        attemptId: fixture.attemptId,
        questionId: fixture.appliedQuestionId,
      }),
    ).toEqual({
      clientInstanceId: "device-no-change",
      seq: 1,
      selectedChoiceIds: [fixture.choiceIds[0]],
    })
    expect(
      await loadResponse(context.pool, {
        attemptId: fixture.attemptId,
        questionId: fixture.staleQuestionId,
      }),
    ).toEqual({
      clientInstanceId: "device-no-change",
      seq: 4,
      selectedChoiceIds: [fixture.choiceIds[2]],
    })
  })

  it("enforces answer-change rules for uppercase UUID spellings", async () => {
    const context = ready()
    const { fixture, token } = await setup({
      allowAnswerChange: false,
      navigation: "forward_only",
      sectionType: "listening",
    })
    const url = `/api/attempts/${fixture.attemptId}/responses`

    await request(context.app.http.getHttpServer() as App)
      .patch(url)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-uppercase",
        responses: [
          {
            questionId: fixture.appliedQuestionId,
            seq: 1,
            selectedChoiceIds: [fixture.choiceIds[0]],
          },
        ],
      })
      .expect(200)

    const identical = await request(context.app.http.getHttpServer() as App)
      .patch(url)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-uppercase",
        responses: [
          {
            questionId: fixture.appliedQuestionId.toUpperCase(),
            seq: 2,
            selectedChoiceIds: [fixture.choiceIds[0].toUpperCase()],
          },
        ],
      })

    expect(identical.status).toBe(200)
    expect(identical.body).toMatchObject({
      results: [
        {
          questionId: fixture.appliedQuestionId.toUpperCase(),
          status: "applied",
        },
      ],
    })

    const changed = await request(context.app.http.getHttpServer() as App)
      .patch(url)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-uppercase",
        responses: [
          {
            questionId: fixture.appliedQuestionId.toUpperCase(),
            seq: 3,
            selectedChoiceIds: [fixture.choiceIds[1].toUpperCase()],
          },
        ],
      })

    expect(changed.status).toBe(200)
    const { results } = changed.body as SnapshotResponseBody

    expect(results[0]).toMatchObject({
      questionId: fixture.appliedQuestionId.toUpperCase(),
      status: "rejected",
      reason: "answer_change_not_allowed",
      retryable: false,
    })
    expect(
      await loadResponse(context.pool, {
        attemptId: fixture.attemptId,
        questionId: fixture.appliedQuestionId,
      }),
    ).toEqual({
      clientInstanceId: "device-uppercase",
      seq: 2,
      selectedChoiceIds: [fixture.choiceIds[0]],
    })
  })

  it("refuses and captures a snapshot spanning two sections", async () => {
    const context = ready()
    const { fixture, token } = await setup({ includeOtherSection: true })

    if (!fixture.otherSection) {
      throw new Error("Other section was not seeded")
    }

    const body = JSON.stringify({
      clientInstanceId: "device-mixed",
      responses: [
        {
          questionId: fixture.appliedQuestionId,
          seq: 1,
          selectedChoiceIds: [fixture.choiceIds[0]],
        },
        {
          questionId: fixture.otherSection.questionId,
          seq: 2,
          selectedChoiceIds: [fixture.otherSection.choiceIds[0]],
        },
      ],
    })

    const response = await request(context.app.http.getHttpServer() as App)
      .patch(`/api/attempts/${fixture.attemptId}/responses`)
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send(body)

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      type: "mixed_sections",
      status: 400,
      retryable: false,
    })
    const { capturedAs } = response.body as CapturedErrorBody

    expect(typeof capturedAs).toBe("string")

    if (typeof capturedAs !== "string") {
      throw new Error("Mixed-section rejection was not captured")
    }

    const { rows } = await context.pool.query<{
      raw_body: string
      byte_size: number | null
    }>("SELECT raw_body, byte_size FROM failed_write WHERE id = $1", [
      capturedAs,
    ])

    expect(rows).toEqual([
      { raw_body: body, byte_size: Buffer.byteLength(body) },
    ])
    expect(
      await context.pool.query(
        "SELECT question_id FROM response WHERE attempt_id = $1",
        [fixture.attemptId],
      ),
    ).toMatchObject({ rows: [] })
  })

  it("applies mixed-section rules using question identity even when one item is invalid", async () => {
    const context = ready()
    const { fixture, token } = await setup({ includeOtherSection: true })

    if (!fixture.otherSection) {
      throw new Error("Other section was not seeded")
    }

    const response = await request(context.app.http.getHttpServer() as App)
      .patch(`/api/attempts/${fixture.attemptId}/responses`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-mixed-invalid",
        responses: [
          {
            questionId: fixture.appliedQuestionId,
            seq: 1,
            selectedChoiceIds: [fixture.choiceIds[0]],
          },
          {
            questionId: fixture.otherSection.questionId,
            seq: "not-a-number",
            selectedChoiceIds: [fixture.otherSection.choiceIds[0]],
          },
        ],
      })

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      type: "mixed_sections",
      status: 400,
      retryable: false,
    })
    expect(
      await context.pool.query(
        "SELECT question_id FROM response WHERE attempt_id = $1",
        [fixture.attemptId],
      ),
    ).toMatchObject({ rows: [] })
  })

  it("applies section expiry using question identity when the item is invalid", async () => {
    const context = ready()
    const { fixture, token } = await setup()

    await context.pool.query(
      `UPDATE attempt
          SET started_at = $2, expires_at = $3,
              current_section_id = $4, current_question_id = $5
        WHERE id = $1`,
      [
        fixture.attemptId,
        new Date("2026-08-27T08:00:00.000Z"),
        new Date("2026-08-27T12:00:00.000Z"),
        fixture.sectionId,
        fixture.appliedQuestionId,
      ],
    )
    await context.pool.query(
      `INSERT INTO attempt_section
         (attempt_id, test_section_id, test_version_id, entered_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        fixture.attemptId,
        fixture.sectionId,
        fixture.versionId,
        new Date("2026-08-27T08:00:00.000Z"),
        new Date("2026-08-27T09:00:00.000Z"),
      ],
    )

    const response = await request(context.app.http.getHttpServer() as App)
      .patch(`/api/attempts/${fixture.attemptId}/responses`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "device-expired-invalid",
        responses: [
          {
            questionId: fixture.appliedQuestionId.toUpperCase(),
            seq: "not-a-number",
            selectedChoiceIds: [fixture.choiceIds[0]],
          },
        ],
      })

    expect(response.status).toBe(410)
    expect(response.body).toEqual({
      type: "section_expired",
      title: "The section's clock ran out.",
      status: 410,
      retryable: false,
    })
    expect(
      await context.pool.query(
        "SELECT question_id FROM response WHERE attempt_id = $1",
        [fixture.attemptId],
      ),
    ).toMatchObject({ rows: [] })
  })

  it("refuses and captures an empty snapshot as empty_batch", async () => {
    const context = ready()
    const { fixture, token } = await setup()
    const body = JSON.stringify({
      clientInstanceId: "device-empty",
      responses: [],
    })

    const response = await request(context.app.http.getHttpServer() as App)
      .patch(`/api/attempts/${fixture.attemptId}/responses`)
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send(body)

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      type: "empty_batch",
      status: 400,
      retryable: false,
    })
    const { capturedAs } = response.body as CapturedErrorBody

    expect(typeof capturedAs).toBe("string")

    if (typeof capturedAs !== "string") {
      throw new Error("Empty-batch rejection was not captured")
    }

    const { rows } = await context.pool.query<{
      raw_body: string
      byte_size: number | null
    }>("SELECT raw_body, byte_size FROM failed_write WHERE id = $1", [
      capturedAs,
    ])

    expect(rows).toEqual([
      { raw_body: body, byte_size: Buffer.byteLength(body) },
    ])
  })
})
