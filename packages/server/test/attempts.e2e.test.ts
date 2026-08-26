import type { PgPool } from "@liam-public/node-postgres"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { createTestApp, type TestApp } from "./helpers/app.js"

interface AttemptStartBody {
  attempt: {
    id: string
    attemptNumber: number
    createdAt: string
    startedAt: string | null
    expiresAt: string | null
    currentSectionId: string | null
    currentQuestionId: string | null
  }
  resumed: boolean
  finalizedPriorAttempt: { id: string; submittedAt: string } | null
}

function body(res: { body: unknown }): AttemptStartBody {
  return res.body as AttemptStartBody
}

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

/**
 * A stale in-progress attempt: started an hour ago, expired ten minutes
 * ago, `status` still `in_progress` -- lazy expiry means nothing has
 * touched the row since the deadline passed.
 */
async function insertStaleAttempt(
  pool: PgPool,
  input: { studentId: string; versionId: string },
): Promise<string> {
  const attemptId = randomUUID()

  await pool.query(
    `INSERT INTO attempt (id, student_id, test_version_id, status, started_at, expires_at)
     VALUES ($1, $2, $3, 'in_progress', now() - interval '1 hour', now() - interval '10 minutes')`,
    [attemptId, input.studentId, input.versionId],
  )

  return attemptId
}

/** A fully graded, already-submitted attempt -- the re-attempt case. */
async function insertFinishedAttempt(
  pool: PgPool,
  input: { studentId: string; versionId: string },
): Promise<string> {
  const attemptId = randomUUID()

  await pool.query(
    `INSERT INTO attempt (
       id, student_id, test_version_id, status, started_at, expires_at,
       submitted_at, points_earned, points_possible, percentage,
       answered_count, unanswered_count, correct_count, incorrect_count, question_count
     ) VALUES (
       $1, $2, $3, 'submitted', now() - interval '1 hour', now() - interval '30 minutes',
       now() - interval '30 minutes', 0, 0, 0, 0, 0, 0, 0, 0
     )`,
    [attemptId, input.studentId, input.versionId],
  )

  return attemptId
}

const SUB = "google-oauth2|attempts-test"
const EMAIL = "tom@example.com"

describe("POST /attempts", () => {
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

  it("is 401 without a token", async () => {
    const a = ready()

    await request(a.http.getHttpServer() as App)
      .post("/api/attempts")
      .send({ slug: "does-not-matter" })
      .expect(401)
  })

  it("is 404 for a valid token that never called POST /session", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-unprovisioned`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/api/attempts")
      .set("Authorization", `Bearer ${token}`)
      .send({ slug: "does-not-matter" })
      .expect(404)
  })

  it("404s for a slug with no published test", async () => {
    const a = ready()
    const { token } = await provision(a, `${SUB}-bad-slug`)

    await request(a.http.getHttpServer() as App)
      .post("/api/attempts")
      .set("Authorization", `Bearer ${token}`)
      .send({ slug: `does-not-exist-${randomUUID()}` })
      .expect(404)
  })

  it("201s a new attempt with resumed: false and no finalizedPriorAttempt", async () => {
    const a = ready()
    const { token } = await provision(a, `${SUB}-first`)
    const pool = a.get<PgPool>(REQUEST_POOL)
    const slug = `attempts-first-${randomUUID()}`
    await insertPublishedTest(pool, { slug, title: "First Attempt Test" })

    const res = await request(a.http.getHttpServer() as App)
      .post("/api/attempts")
      .set("Authorization", `Bearer ${token}`)
      .send({ slug })
      .expect(201)

    const parsed = body(res)

    expect(parsed.resumed).toBe(false)
    expect(parsed.finalizedPriorAttempt).toBeNull()
    expect(parsed.attempt.attemptNumber).toBe(1)
    expect(parsed.attempt.startedAt).toBeNull()
    expect(parsed.attempt.expiresAt).toBeNull()
    expect(typeof parsed.attempt.id).toBe("string")
  })

  it("resumes rather than duplicating when called twice back to back", async () => {
    const a = ready()
    const { token } = await provision(a, `${SUB}-resume`)
    const pool = a.get<PgPool>(REQUEST_POOL)
    const slug = `attempts-resume-${randomUUID()}`
    await insertPublishedTest(pool, { slug, title: "Resume Test" })

    const first = await request(a.http.getHttpServer() as App)
      .post("/api/attempts")
      .set("Authorization", `Bearer ${token}`)
      .send({ slug })
      .expect(201)

    const second = await request(a.http.getHttpServer() as App)
      .post("/api/attempts")
      .set("Authorization", `Bearer ${token}`)
      .send({ slug })
      .expect(201)

    expect(body(second).resumed).toBe(true)
    expect(body(second).finalizedPriorAttempt).toBeNull()
    expect(body(second).attempt.id).toBe(body(first).attempt.id)

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM attempt WHERE id = $1`,
      [body(first).attempt.id],
    )
    expect(Number(rows[0].count)).toBe(1)
  })

  it("finalizes a stale in-progress attempt and starts a new one", async () => {
    const a = ready()
    const { token, studentId } = await provision(a, `${SUB}-expired`)
    const pool = a.get<PgPool>(REQUEST_POOL)
    const slug = `attempts-expired-${randomUUID()}`
    const { versionId } = await insertPublishedTest(pool, {
      slug,
      title: "Expired Test",
    })
    const staleId = await insertStaleAttempt(pool, { studentId, versionId })

    const res = await request(a.http.getHttpServer() as App)
      .post("/api/attempts")
      .set("Authorization", `Bearer ${token}`)
      .send({ slug })
      .expect(201)

    const parsed = body(res)

    expect(parsed.resumed).toBe(false)
    expect(parsed.finalizedPriorAttempt?.id).toBe(staleId)
    expect(parsed.attempt.id).not.toBe(staleId)
    expect(parsed.attempt.attemptNumber).toBe(2)

    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM attempt WHERE id = $1`,
      [staleId],
    )
    expect(rows[0].status).toBe("expired")
  })

  it("lets a finished attempt be re-attempted", async () => {
    const a = ready()
    const { token, studentId } = await provision(a, `${SUB}-reattempt`)
    const pool = a.get<PgPool>(REQUEST_POOL)
    const slug = `attempts-reattempt-${randomUUID()}`
    const { versionId } = await insertPublishedTest(pool, {
      slug,
      title: "Re-attempt Test",
    })
    await insertFinishedAttempt(pool, { studentId, versionId })

    const res = await request(a.http.getHttpServer() as App)
      .post("/api/attempts")
      .set("Authorization", `Bearer ${token}`)
      .send({ slug })
      .expect(201)

    const parsed = body(res)

    expect(parsed.resumed).toBe(false)
    // Not fired: the prior attempt is already 'submitted', so there is
    // nothing here for this request to finalize.
    expect(parsed.finalizedPriorAttempt).toBeNull()
    expect(parsed.attempt.attemptNumber).toBe(2)
  })

  it("does not 500 when two starts race for the same (student, version)", async () => {
    const a = ready()
    const { token } = await provision(a, `${SUB}-race`)
    const pool = a.get<PgPool>(REQUEST_POOL)
    const slug = `attempts-race-${randomUUID()}`
    await insertPublishedTest(pool, { slug, title: "Race Test" })

    const [first, second] = await Promise.all([
      request(a.http.getHttpServer() as App)
        .post("/api/attempts")
        .set("Authorization", `Bearer ${token}`)
        .send({ slug }),
      request(a.http.getHttpServer() as App)
        .post("/api/attempts")
        .set("Authorization", `Bearer ${token}`)
        .send({ slug }),
    ])

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(body(first).attempt.id).toBe(body(second).attempt.id)

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM attempt WHERE id = $1`,
      [body(first).attempt.id],
    )
    expect(Number(rows[0].count)).toBe(1)
  })
})
