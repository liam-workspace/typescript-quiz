import type { PgPool } from "@liam-public/node-postgres"
import { testDocumentSchema, type TestDocument } from "@pp/common"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { createTestApp, type TestApp } from "./helpers/app.js"

const SUB = "google-oauth2|attempts-enter-test"
const EMAIL = "tom@example.com"

/**
 * Two sections, one question each -- enough to exercise the whole-test
 * clock starting on section 1's entry and staying untouched on section 2's,
 * mirroring the runner envelope e2e fixture.
 */
function twoSectionDoc(slug: string): TestDocument {
  return testDocumentSchema.parse({
    title: "Section Entry E2E Test",
    slug,
    level: "primary-step-1",
    durationSeconds: 200,
    sections: [
      {
        title: "Listening — Part 1",
        type: "listening",
        durationSeconds: 100,
        navigation: "forward_only",
        allowAnswerChange: false,
        playback: null,
        instructions: ["Put your headphones on now."],
        groups: [
          {
            questions: [
              {
                questionKey: "q1",
                prompt: "What does the boy want to do?",
                type: "single_choice",
                points: 1,
                choices: [
                  { label: "Read a book", isCorrect: true },
                  { label: "Play football", isCorrect: false },
                ],
              },
            ],
          },
        ],
      },
      {
        title: "Reading",
        type: "reading",
        durationSeconds: 100,
        navigation: "free",
        allowAnswerChange: true,
        playback: null,
        instructions: [],
        groups: [
          {
            questions: [
              {
                questionKey: "q2",
                prompt: "Why did the class eat inside?",
                type: "single_choice",
                points: 1,
                choices: [
                  { label: "It began to rain", isCorrect: true },
                  { label: "The bus was late", isCorrect: false },
                ],
              },
            ],
          },
        ],
      },
    ],
  })
}

/** No content -- fine for the 410 path, which finalizes before ever reading it. */
async function insertPublishedTest(
  pool: PgPool,
  input: { slug: string; title: string },
): Promise<{ testId: string; versionId: string }> {
  const testId = randomUUID()
  const versionId = randomUUID()

  await pool.query(`INSERT INTO test (id, slug) VALUES ($1, $2)`, [
    testId,
    input.slug,
  ])
  await pool.query(
    `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
     VALUES ($1, $2, 1, $3, 1000)`,
    [versionId, testId, input.title],
  )
  await pool.query(
    `UPDATE test_version SET published_at = now() WHERE id = $1`,
    [versionId],
  )
  await pool.query(`UPDATE test SET current_version_id = $1 WHERE id = $2`, [
    versionId,
    testId,
  ])

  return { testId, versionId }
}

async function insertStaleAttempt(
  pool: PgPool,
  input: {
    studentId: string
    versionId: string
    startedAt: Date
    expiresAt: Date
  },
): Promise<string> {
  const attemptId = randomUUID()

  await pool.query(
    `INSERT INTO attempt (id, student_id, test_version_id, status, started_at, expires_at)
     VALUES ($1, $2, $3, 'in_progress', $4, $5)`,
    [
      attemptId,
      input.studentId,
      input.versionId,
      input.startedAt,
      input.expiresAt,
    ],
  )

  return attemptId
}

/**
 * Marks section A's attempt_section row complete via direct SQL, standing
 * in for the phase-4/5 write path this task does not implement --
 * `attempt_section_counts_reconcile` requires the full graded breakdown the
 * moment completed_at is non-null, hence the arbitrary-but-valid numbers.
 */
async function closeSection(
  pool: PgPool,
  attemptId: string,
  sectionId: string,
): Promise<void> {
  await pool.query(
    `UPDATE attempt_section
        SET completed_at = now(), points_earned = 0, points_possible = 1,
            answered_count = 0, unanswered_count = 1,
            correct_count = 0, incorrect_count = 0
      WHERE attempt_id = $1 AND test_section_id = $2`,
    [attemptId, sectionId],
  )
}

interface SectionEntryBody {
  sectionId: string
  title: string
  type: string
  questionCount: number
  enteredAt: string
  expiresAt: string
  serverTime: string
  attemptStartedAt?: string
  attemptExpiresAt?: string
  navigation: string
  allowAnswerChange: boolean
  playback: unknown
  instructions: string[]
}

describe("POST /attempts/:id/sections/:sectionId/enter", () => {
  let app: TestApp | undefined = undefined

  beforeAll(async () => {
    app = await createTestApp()
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

  async function provision(
    a: TestApp,
    sub: string,
  ): Promise<{ token: string; studentId: string }> {
    const token = await a.mint({ sub, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)
    const me = await request(a.http.getHttpServer() as App)
      .get("/api/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    return { token, studentId: (me.body as { id: string }).id }
  }

  async function startAttempt(
    a: TestApp,
    token: string,
    slug: string,
  ): Promise<string> {
    const res = await request(a.http.getHttpServer() as App)
      .post("/api/attempts")
      .set("Authorization", `Bearer ${token}`)
      .send({ slug })
    const parsed = res.body as { id: string }

    return parsed.id
  }

  async function importAndPublish(
    a: TestApp,
    slug: string,
  ): Promise<{ testId: string; sectionIds: string[] }> {
    const adminToken = await a.mint({
      sub: `${SUB}-admin-${slug}`,
      email: EMAIL,
      isAdmin: true,
    })
    const imported = await request(a.http.getHttpServer() as App)
      .post("/api/admin/tests/import")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(twoSectionDoc(slug))
      .expect(201)
    const { testId } = imported.body as { testId: string }
    await request(a.http.getHttpServer() as App)
      .post(`/api/admin/tests/${testId}/publish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)

    const pool = a.get<PgPool>(REQUEST_POOL)
    const { rows } = await pool.query<{ id: string }>(
      `SELECT ts.id
         FROM test_section ts
         JOIN test_version tv ON tv.id = ts.test_version_id
         JOIN test t ON t.id = tv.test_id
        WHERE t.slug = $1
        ORDER BY ts.ordinal`,
      [slug],
    )

    return { testId, sectionIds: rows.map((r) => r.id) }
  }

  it("200s and starts the whole-test clock on first entry", async () => {
    const fixedNow = new Date("2027-03-01T09:00:00.000Z")
    const fixedApp = await createTestApp({ now: fixedNow })

    try {
      const slug = `enter-first-${randomUUID()}`
      const { sectionIds } = await importAndPublish(fixedApp, slug)
      const [listeningSectionId] = sectionIds

      const { token } = await provision(fixedApp, `${SUB}-first`)
      const attemptId = await startAttempt(fixedApp, token, slug)

      const res = await request(fixedApp.http.getHttpServer() as App)
        .post(`/api/attempts/${attemptId}/sections/${listeningSectionId}/enter`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200)

      const body = res.body as SectionEntryBody

      expect(body.sectionId).toBe(listeningSectionId)
      expect(body.title).toBe("Listening — Part 1")
      expect(body.type).toBe("listening")
      expect(body.questionCount).toBe(1)
      expect(body.enteredAt).toBe(fixedNow.toISOString())
      // Section duration is 100s.
      expect(body.expiresAt).toBe(
        new Date(fixedNow.getTime() + 100 * 1000).toISOString(),
      )
      expect(body.attemptStartedAt).toBe(fixedNow.toISOString())
      // Whole-test duration is 200s.
      expect(body.attemptExpiresAt).toBe(
        new Date(fixedNow.getTime() + 200 * 1000).toISOString(),
      )
      expect(body.navigation).toBe("forward_only")
      expect(body.allowAnswerChange).toBe(false)
      expect(body.playback).toBeNull()
      expect(body.instructions).toEqual(["Put your headphones on now."])

      const pool = fixedApp.get<PgPool>(REQUEST_POOL)
      const { rows } = await pool.query<{
        started_at: Date
        expires_at: Date
        current_section_id: string
      }>(
        `SELECT started_at, expires_at, current_section_id FROM attempt WHERE id = $1`,
        [attemptId],
      )
      expect(rows[0].started_at.toISOString()).toBe(fixedNow.toISOString())
      expect(rows[0].current_section_id).toBe(listeningSectionId)
    } finally {
      await fixedApp.close()
    }
  })

  it("409s section_still_open with the openapi Problem shape", async () => {
    const a = ready()
    const slug = `enter-conflict-${randomUUID()}`
    const { sectionIds } = await importAndPublish(a, slug)
    const [listeningSectionId, readingSectionId] = sectionIds

    const { token } = await provision(a, `${SUB}-conflict`)
    const attemptId = await startAttempt(a, token, slug)

    // Enters section 1 for real, through the app's own path.
    await request(a.http.getHttpServer() as App)
      .post(`/api/attempts/${attemptId}/sections/${listeningSectionId}/enter`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    // Section 1 is still open -- entering section 2 must be refused, not
    // silently close section 1 on the caller's behalf.
    const res = await request(a.http.getHttpServer() as App)
      .post(`/api/attempts/${attemptId}/sections/${readingSectionId}/enter`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409)

    // Repo-wide claim, not just plan 5's own routes: this is a plan-3 route
    // (attempts.service.ts's sectionStillOpenError, pre-dating
    // ProblemException) now converted to speak the same contract shape as
    // everything else.
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/)

    const problem = res.body as { type: string; title: string; status: number }

    expect(problem.type).toBe("section_still_open")
    expect(problem.status).toBe(409)
    expect(problem).not.toHaveProperty("error")
    expect(problem).not.toHaveProperty("statusCode")

    // Bracketed the other way: closing section 1 first lets section 2 in.
    await closeSection(
      a.get<PgPool>(REQUEST_POOL),
      attemptId,
      listeningSectionId,
    )

    await request(a.http.getHttpServer() as App)
      .post(`/api/attempts/${attemptId}/sections/${readingSectionId}/enter`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
  })

  it("410s a past-deadline attempt without ever inserting an attempt_section row", async () => {
    const fixedNow = new Date("2027-03-15T12:00:00.000Z")
    const startedAt = new Date(fixedNow.getTime() - 60 * 60 * 1000)
    const expiresAt = new Date(fixedNow.getTime() - 10 * 60 * 1000)
    const fixedApp = await createTestApp({ now: fixedNow })

    try {
      const { token, studentId } = await provision(fixedApp, `${SUB}-expired`)
      const pool = fixedApp.get<PgPool>(REQUEST_POOL)
      const slug = `enter-expired-${randomUUID()}`
      const { versionId } = await insertPublishedTest(pool, {
        slug,
        title: "Enter Expired Test",
      })
      const attemptId = await insertStaleAttempt(pool, {
        studentId,
        versionId,
        startedAt,
        expiresAt,
      })

      const res = await request(fixedApp.http.getHttpServer() as App)
        .post(`/api/attempts/${attemptId}/sections/${randomUUID()}/enter`)
        .set("Authorization", `Bearer ${token}`)
        .expect(410)

      const problem = res.body as { type: string; status: number }

      expect(problem.type).toBe("attempt_expired")
      expect(problem.status).toBe(410)

      const { rows: attemptRows } = await pool.query<{ status: string }>(
        `SELECT status FROM attempt WHERE id = $1`,
        [attemptId],
      )
      expect(attemptRows[0].status).toBe("expired")

      const { rows: sectionRows } = await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM attempt_section WHERE attempt_id = $1`,
        [attemptId],
      )
      expect(Number(sectionRows[0].count)).toBe(0)
    } finally {
      await fixedApp.close()
    }
  })

  it("401s with no token", async () => {
    const a = ready()

    await request(a.http.getHttpServer() as App)
      .post(`/api/attempts/${randomUUID()}/sections/${randomUUID()}/enter`)
      .expect(401)
  })

  it("403s for another student's attempt", async () => {
    const a = ready()
    const slug = `enter-forbidden-${randomUUID()}`
    const { sectionIds } = await importAndPublish(a, slug)
    const [listeningSectionId] = sectionIds

    const owner = await provision(a, `${SUB}-forbidden-owner`)
    const attemptId = await startAttempt(a, owner.token, slug)

    const stranger = await provision(a, `${SUB}-forbidden-stranger`)

    await request(a.http.getHttpServer() as App)
      .post(`/api/attempts/${attemptId}/sections/${listeningSectionId}/enter`)
      .set("Authorization", `Bearer ${stranger.token}`)
      .expect(403)

    // Bracketed the other way: the SAME attempt id and section, the
    // owner's token, 200.
    await request(a.http.getHttpServer() as App)
      .post(`/api/attempts/${attemptId}/sections/${listeningSectionId}/enter`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200)
  })
})
