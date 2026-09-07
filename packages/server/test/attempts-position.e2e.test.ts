import type { PgPool } from "@liam-public/node-postgres"
import { testDocumentSchema, type TestDocument } from "@pp/common"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { createTestApp, type TestApp } from "./helpers/app.js"

const SUB = "google-oauth2|attempts-position-test"
const EMAIL = "tom@example.com"

function positionDoc(slug: string): TestDocument {
  return testDocumentSchema.parse({
    title: "ZZ Position E2E Test",
    slug,
    level: "primary-step-1",
    durationSeconds: 300,
    sections: [
      {
        title: "Forward only",
        type: "listening",
        durationSeconds: 300,
        navigation: "forward_only",
        allowAnswerChange: false,
        playback: null,
        instructions: [],
        groups: [
          {
            questions: [
              {
                questionKey: "q1",
                prompt: "First question",
                type: "single_choice",
                points: 1,
                choices: [
                  { label: "First A", isCorrect: true },
                  { label: "First B", isCorrect: false },
                ],
              },
              {
                questionKey: "q2",
                prompt: "Second question",
                type: "single_choice",
                points: 1,
                choices: [
                  { label: "Second A", isCorrect: true },
                  { label: "Second B", isCorrect: false },
                ],
              },
              {
                questionKey: "q3",
                prompt: "Third question",
                type: "single_choice",
                points: 1,
                choices: [
                  { label: "Third A", isCorrect: true },
                  { label: "Third B", isCorrect: false },
                ],
              },
            ],
          },
        ],
      },
    ],
  })
}

async function provision(
  app: TestApp,
  sub: string,
): Promise<{ token: string; studentId: string }> {
  const token = await app.mint({ sub, email: EMAIL })

  await request(app.http.getHttpServer() as App)
    .post("/api/session")
    .set("Authorization", `Bearer ${token}`)
    .expect(201)
  const me = await request(app.http.getHttpServer() as App)
    .get("/api/me")
    .set("Authorization", `Bearer ${token}`)
    .expect(200)

  return { token, studentId: (me.body as { id: string }).id }
}

async function importAndPublish(
  app: TestApp,
  slug: string,
): Promise<{ sectionId: string; questionIds: string[] }> {
  const adminToken = await app.mint({
    sub: `${SUB}-admin-${slug}`,
    email: EMAIL,
    isAdmin: true,
  })
  const imported = await request(app.http.getHttpServer() as App)
    .post("/api/admin/tests/import")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(positionDoc(slug))
    .expect(201)
  const { testId } = imported.body as { testId: string }

  await request(app.http.getHttpServer() as App)
    .post(`/api/admin/tests/${testId}/publish`)
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200)

  const pool = app.get<PgPool>(REQUEST_POOL)
  const { rows } = await pool.query<{
    section_id: string
    question_id: string
  }>(
    `SELECT ts.id AS section_id, q.id AS question_id
       FROM test_section ts
       JOIN question_group qg ON qg.test_section_id = ts.id
       JOIN question q ON q.question_group_id = qg.id
       JOIN test_version tv ON tv.id = ts.test_version_id
       JOIN test t ON t.id = tv.test_id
      WHERE t.slug = $1
      ORDER BY q.ordinal`,
    [slug],
  )
  const [first] = rows

  return {
    sectionId: first.section_id,
    questionIds: rows.map((row) => row.question_id),
  }
}

async function startAndEnter(
  app: TestApp,
  input: { token: string; slug: string; sectionId: string },
): Promise<string> {
  const started = await request(app.http.getHttpServer() as App)
    .post("/api/attempts")
    .set("Authorization", `Bearer ${input.token}`)
    .send({ slug: input.slug })
    .expect(201)
  const { id } = started.body as { id: string }

  await request(app.http.getHttpServer() as App)
    .post(`/api/attempts/${id}/sections/${input.sectionId}/enter`)
    .set("Authorization", `Bearer ${input.token}`)
    .expect(200)

  return id
}

async function insertTestVersion(pool: PgPool, slug: string): Promise<string> {
  const testId = randomUUID()
  const versionId = randomUUID()

  await pool.query(`INSERT INTO test (id, slug) VALUES ($1, $2)`, [
    testId,
    slug,
  ])
  await pool.query(
    `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
     VALUES ($1, $2, 1, 'Expired Position Test', 300)`,
    [versionId, testId],
  )

  return versionId
}

describe("PUT /attempts/:id/position", () => {
  let app: TestApp | undefined = undefined
  let slug = ""
  let sectionId = ""
  let questionIds: string[] = []

  beforeAll(async () => {
    app = await createTestApp()
    slug = `position-shared-${randomUUID()}`
    const { sectionId: importedSectionId, questionIds: importedQuestionIds } =
      await importAndPublish(app, slug)

    sectionId = importedSectionId
    questionIds = importedQuestionIds
  })

  afterAll(async () => {
    await app?.close()
  })

  function ready(): TestApp {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    return app
  }

  it("204s with no body for a forward move and 409s navigation_locked for a backward move", async () => {
    const a = ready()
    const [firstQuestionId, , thirdQuestionId] = questionIds
    const { token } = await provision(a, `${SUB}-direction`)
    const attemptId = await startAndEnter(a, { token, slug, sectionId })

    const forward = await request(a.http.getHttpServer() as App)
      .put(`/api/attempts/${attemptId}/position`)
      .set("Authorization", `Bearer ${token}`)
      .send({ sectionId, questionId: thirdQuestionId })
      .expect(204)

    expect(forward.text).toBe("")

    const backward = await request(a.http.getHttpServer() as App)
      .put(`/api/attempts/${attemptId}/position`)
      .set("Authorization", `Bearer ${token}`)
      .send({ sectionId, questionId: firstQuestionId })
      .expect(409)
    const problem = backward.body as {
      type: string
      title: string
      status: number
    }

    expect(problem.type).toBe("navigation_locked")
    expect(problem.title).toBe("This section runs forward only.")
    expect(problem.status).toBe(409)
  })

  it("403s for another student's attempt and 204s the same move for its owner", async () => {
    const a = ready()
    const [, secondQuestionId] = questionIds
    const owner = await provision(a, `${SUB}-forbidden-owner`)
    const attemptId = await startAndEnter(a, {
      token: owner.token,
      slug,
      sectionId,
    })
    const stranger = await provision(a, `${SUB}-forbidden-stranger`)

    await request(a.http.getHttpServer() as App)
      .put(`/api/attempts/${attemptId}/position`)
      .set("Authorization", `Bearer ${stranger.token}`)
      .send({ sectionId, questionId: secondQuestionId })
      .expect(403)

    await request(a.http.getHttpServer() as App)
      .put(`/api/attempts/${attemptId}/position`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ sectionId, questionId: secondQuestionId })
      .expect(204)
  })

  it("401s with no token", async () => {
    const a = ready()

    await request(a.http.getHttpServer() as App)
      .put(`/api/attempts/${randomUUID()}/position`)
      .send({ sectionId: randomUUID(), questionId: randomUUID() })
      .expect(401)
  })

  it("410s and fully grades an attempt expired according to the injected clock", async () => {
    const fixedNow = new Date("2027-04-15T12:00:00.000Z")
    const expiresAt = new Date(fixedNow.getTime() - 10 * 60 * 1000)
    const fixedApp = await createTestApp({ now: fixedNow })

    try {
      const { token, studentId } = await provision(fixedApp, `${SUB}-expired`)
      const pool = fixedApp.get<PgPool>(REQUEST_POOL)
      const versionId = await insertTestVersion(
        pool,
        `position-expired-${randomUUID()}`,
      )
      const attemptId = randomUUID()

      await pool.query(
        `INSERT INTO attempt
           (id, student_id, test_version_id, status, started_at, expires_at)
         VALUES ($1, $2, $3, 'in_progress', $4, $5)`,
        [
          attemptId,
          studentId,
          versionId,
          new Date(fixedNow.getTime() - 60 * 60 * 1000),
          expiresAt,
        ],
      )

      const res = await request(fixedApp.http.getHttpServer() as App)
        .put(`/api/attempts/${attemptId}/position`)
        .set("Authorization", `Bearer ${token}`)
        .send({ sectionId: randomUUID(), questionId: randomUUID() })
        .expect(410)
      const problem = res.body as {
        type: string
        status: number
        attempt: { id: string; submittedAt: string }
      }

      expect(problem.type).toBe("attempt_expired")
      expect(problem.status).toBe(410)
      expect(problem.attempt.id).toBe(attemptId)
      expect(problem.attempt.submittedAt).toBe(expiresAt.toISOString())

      const { rows } = await pool.query<{
        status: string
        submitted_at: Date
        points_earned: number
        points_possible: number
        percentage: string
        answered_count: number
        unanswered_count: number
        correct_count: number
        incorrect_count: number
        question_count: number
      }>(
        `SELECT status, submitted_at, points_earned, points_possible, percentage,
                answered_count, unanswered_count, correct_count, incorrect_count,
                question_count
           FROM attempt
          WHERE id = $1`,
        [attemptId],
      )
      const [attempt] = rows

      expect(attempt.status).toBe("expired")
      expect(attempt.submitted_at.toISOString()).toBe(expiresAt.toISOString())
      expect(typeof attempt.percentage).toBe("string")
      expect([
        attempt.points_earned,
        attempt.points_possible,
        Number(attempt.percentage),
        attempt.answered_count,
        attempt.unanswered_count,
        attempt.correct_count,
        attempt.incorrect_count,
        attempt.question_count,
      ]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    } finally {
      await fixedApp.close()
    }
  })

  it("410s section_expired without finalizing an attempt whose section clock elapsed", async () => {
    const fixedNow = new Date("2027-05-15T12:00:00.000Z")
    const fixedApp = await createTestApp({ now: fixedNow })

    try {
      const fixedSlug = `position-section-expired-${randomUUID()}`
      const fixedFixture = await importAndPublish(fixedApp, fixedSlug)
      const [firstQuestionId, secondQuestionId] = fixedFixture.questionIds
      const { token } = await provision(fixedApp, `${SUB}-section-expired`)
      const attemptId = await startAndEnter(fixedApp, {
        token,
        slug: fixedSlug,
        sectionId: fixedFixture.sectionId,
      })
      const pool = fixedApp.get<PgPool>(REQUEST_POOL)

      await pool.query(
        `UPDATE attempt_section
            SET entered_at = $3, expires_at = $4
          WHERE attempt_id = $1 AND test_section_id = $2`,
        [
          attemptId,
          fixedFixture.sectionId,
          new Date(fixedNow.getTime() - 20 * 60 * 1000),
          new Date(fixedNow.getTime() - 10 * 60 * 1000),
        ],
      )

      const res = await request(fixedApp.http.getHttpServer() as App)
        .put(`/api/attempts/${attemptId}/position`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          sectionId: fixedFixture.sectionId,
          questionId: secondQuestionId,
        })
        .expect(410)
      const problem = res.body as {
        type: string
        status: number
        attempt?: unknown
      }

      expect(problem.type).toBe("section_expired")
      expect(problem.status).toBe(410)
      expect(problem.attempt).toBeUndefined()

      const { rows } = await pool.query<{
        status: string
        current_question_id: string
      }>(`SELECT status, current_question_id FROM attempt WHERE id = $1`, [
        attemptId,
      ])
      const [attempt] = rows

      expect(attempt.status).toBe("in_progress")
      expect(attempt.current_question_id).toBe(firstQuestionId)
    } finally {
      await fixedApp.close()
    }
  })
})
