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
  type WriteFixture,
} from "./helpers/write-fixture.js"

const NOW = new Date("2026-08-28T09:10:00.000Z")
const STARTED_AT = new Date("2026-08-28T09:00:00.000Z")
const ATTEMPT_EXPIRES_AT = new Date("2026-08-28T10:00:00.000Z")
const SECTION_EXPIRES_AT = new Date("2026-08-28T09:25:00.000Z")

interface FinishContext {
  fixture: WriteFixture & {
    otherSection: NonNullable<WriteFixture["otherSection"]>
  }
  token: string
}

interface FinishBody {
  sectionId: string
  status: "finished"
  nextSectionId: string | null
  finalFlush: Array<Record<string, unknown>>
}

describe("POST /api/attempts/:id/sections/:sectionId/finish", () => {
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
      throw new Error("Finish-section test app was not initialized")
    }

    return { app, pool }
  }

  async function setup(
    subject = `finish-section-${randomUUID()}`,
  ): Promise<FinishContext> {
    const context = ready()
    const student = await provisionStudent(context.app, subject)
    const fixture = await seedWriteFixture(context.pool, student.studentId, {
      includeOtherSection: true,
      sectionType: "listening",
      navigation: "forward_only",
      allowAnswerChange: false,
    })

    if (!fixture.otherSection) {
      throw new Error("expected the finish fixture to have a next section")
    }

    await context.pool.query(
      `UPDATE attempt
          SET started_at = $2, expires_at = $3,
              current_section_id = $4, current_question_id = $5
        WHERE id = $1`,
      [
        fixture.attemptId,
        STARTED_AT,
        ATTEMPT_EXPIRES_AT,
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
        STARTED_AT,
        SECTION_EXPIRES_AT,
      ],
    )

    return {
      fixture: { ...fixture, otherSection: fixture.otherSection },
      token: student.token,
    }
  }

  it("applies each remainder item independently, grades the section, and returns the next section", async () => {
    const context = ready()
    const { fixture, token } = await setup()
    const invalidChoiceId = randomUUID()

    const response = await request(context.app.http.getHttpServer() as App)
      .post(
        `/api/attempts/${fixture.attemptId}/sections/${fixture.sectionId}/finish`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientInstanceId: "finish-device",
        responses: [
          {
            questionId: fixture.appliedQuestionId,
            seq: 1,
            selectedChoiceIds: [fixture.choiceIds[0]],
          },
          {
            questionId: fixture.staleQuestionId,
            seq: 2,
            selectedChoiceIds: [invalidChoiceId],
          },
        ],
      })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      sectionId: fixture.sectionId,
      status: "finished",
      nextSectionId: fixture.otherSection.sectionId,
      finalFlush: [
        { questionId: fixture.appliedQuestionId, status: "applied" },
        {
          questionId: fixture.staleQuestionId,
          status: "rejected",
          reason: "invalid",
          retryable: false,
        },
      ],
    } satisfies FinishBody)
    expect(typeof (response.body as FinishBody).finalFlush[1]?.capturedAs).toBe(
      "string",
    )
    expect(
      await loadResponse(context.pool, {
        attemptId: fixture.attemptId,
        questionId: fixture.appliedQuestionId,
      }),
    ).toMatchObject({
      clientInstanceId: "finish-device",
      seq: 1,
      selectedChoiceIds: [fixture.choiceIds[0]],
    })

    const { rows } = await context.pool.query<{
      completed_at: Date
      points_earned: number
      answered_count: number
      correct_count: number
    }>(
      `SELECT completed_at, points_earned, answered_count, correct_count
         FROM attempt_section
        WHERE attempt_id = $1 AND test_section_id = $2`,
      [fixture.attemptId, fixture.sectionId],
    )

    expect(rows).toEqual([
      {
        completed_at: NOW,
        points_earned: 1,
        answered_count: 1,
        correct_count: 1,
      },
    ])
  })

  it("403s when the attempt belongs to another student", async () => {
    const context = ready()
    const owner = await setup()
    const intruder = await provisionStudent(
      context.app,
      `finish-section-intruder-${randomUUID()}`,
    )

    const response = await request(context.app.http.getHttpServer() as App)
      .post(
        `/api/attempts/${owner.fixture.attemptId}/sections/${owner.fixture.sectionId}/finish`,
      )
      .set("Authorization", `Bearer ${intruder.token}`)
      .send({ clientInstanceId: "intruder-device", responses: [] })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      type: "not_your_attempt",
      status: 403,
    })
  })

  it("409s when the requested section is not the attempt's current open section", async () => {
    const context = ready()
    const { fixture, token } = await setup()

    const response = await request(context.app.http.getHttpServer() as App)
      .post(
        `/api/attempts/${fixture.attemptId}/sections/${fixture.otherSection.sectionId}/finish`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({ clientInstanceId: "wrong-section-device", responses: [] })

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({
      type: "section_not_open",
      status: 409,
      retryable: false,
    })
  })

  it("410s and finalizes an attempt whose whole-test clock expired", async () => {
    const context = ready()
    const { fixture, token } = await setup()
    const expiredAt = new Date("2026-08-28T09:09:00.000Z")

    await context.pool.query(
      `UPDATE attempt SET expires_at = $2 WHERE id = $1`,
      [fixture.attemptId, expiredAt],
    )

    const response = await request(context.app.http.getHttpServer() as App)
      .post(
        `/api/attempts/${fixture.attemptId}/sections/${fixture.sectionId}/finish`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({ clientInstanceId: "expired-device", responses: [] })

    expect(response.status).toBe(410)
    expect(response.body).toMatchObject({
      type: "attempt_expired",
      status: 410,
      retryable: false,
      attempt: {
        id: fixture.attemptId,
        status: "expired",
        submittedAt: expiredAt.toISOString(),
        resultUrl: `/attempts/${fixture.attemptId}/result`,
      },
    })
  })
})
