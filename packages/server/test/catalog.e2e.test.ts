import type { PgPool } from "@liam-public/node-postgres"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { createTestApp, type TestApp } from "./helpers/app.js"

interface TestCardBody {
  id: string
  slug: string
  title: string
  level: string | null
  durationSeconds: number
  sections: Array<{ type: string; questionCount: number }>
  inProgressAttemptId: string | null
  attemptCount: number
  bestAttempt: {
    attemptId: string
    submittedAt: string
    pointsEarned: number
    pointsPossible: number
    percentage: number
  } | null
}

interface CatalogBody {
  tests: TestCardBody[]
  nextCursor: string | null
  summary: { attemptCount: number; averagePct: number; bestPct: number }
}

function body(res: { body: unknown }): CatalogBody {
  return res.body as CatalogBody
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

async function insertInProgressAttempt(
  pool: PgPool,
  input: { studentId: string; versionId: string },
): Promise<string> {
  const attemptId = randomUUID()

  await pool.query(
    `INSERT INTO attempt (id, student_id, test_version_id, status)
     VALUES ($1, $2, $3, 'in_progress')`,
    [attemptId, input.studentId, input.versionId],
  )

  return attemptId
}

const SUB = "google-oauth2|catalog-test"
const EMAIL = "tom@example.com"

describe("GET /tests", () => {
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

  it("is 401 without a token", async () => {
    const a = ready()

    await request(a.http.getHttpServer() as App)
      .get("/tests")
      .expect(401)
  })

  it("is 404 for a valid token that never called POST /session", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-unprovisioned`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .get("/tests")
      .set("Authorization", `Bearer ${token}`)
      .expect(404)
  })

  it("lists a published test with this student's standing", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-listing`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    const pool = a.get<PgPool>(REQUEST_POOL)
    const { testId } = await insertPublishedTest(pool, {
      slug: `catalog-listing-${randomUUID()}`,
      title: "Catalog Listing Test",
    })

    const res = await request(a.http.getHttpServer() as App)
      .get("/tests")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    const card = body(res).tests.find((c) => c.id === testId)

    expect(card).toBeDefined()
    expect(card?.title).toBe("Catalog Listing Test")
    expect(card?.sections).toEqual([])
    expect(card?.inProgressAttemptId).toBeNull()
    expect(card?.attemptCount).toBe(0)
    expect(typeof card?.attemptCount).toBe("number")
    expect(card?.bestAttempt).toBeNull()
    expect(typeof body(res).summary.attemptCount).toBe("number")
    expect(typeof body(res).summary.averagePct).toBe("number")
    expect(typeof body(res).summary.bestPct).toBe("number")
  })

  it("reports inProgressAttemptId once an attempt is started", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-in-progress`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)
    const me = await request(a.http.getHttpServer() as App)
      .get("/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
    const studentId = (me.body as { id: string }).id

    const pool = a.get<PgPool>(REQUEST_POOL)
    const { testId, versionId } = await insertPublishedTest(pool, {
      slug: `catalog-in-progress-${randomUUID()}`,
      title: "Catalog In Progress Test",
    })
    const attemptId = await insertInProgressAttempt(pool, {
      studentId,
      versionId,
    })

    const res = await request(a.http.getHttpServer() as App)
      .get("/tests")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    const card = body(res).tests.find((c) => c.id === testId)

    expect(card?.inProgressAttemptId).toBe(attemptId)
  })

  it("rejects an out-of-range limit with 400", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-bad-limit`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    await request(a.http.getHttpServer() as App)
      .get("/tests")
      .query({ limit: 51 })
      .set("Authorization", `Bearer ${token}`)
      .expect(400)

    await request(a.http.getHttpServer() as App)
      .get("/tests")
      .query({ limit: 0 })
      .set("Authorization", `Bearer ${token}`)
      .expect(400)
  })

  it("rejects an undecodable cursor with 400", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-bad-cursor`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    await request(a.http.getHttpServer() as App)
      .get("/tests")
      .query({ cursor: "not-a-valid-cursor!!" })
      .set("Authorization", `Bearer ${token}`)
      .expect(400)
  })
})
