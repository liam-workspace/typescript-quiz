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

interface TestBriefSectionBody {
  id: string
  type: string
  title: string
  ordinal: number
  questionCount: number
  durationSeconds: number
  navigation: string
  allowAnswerChange: boolean
  playback: {
    maxPlays: number | null
    allowPause: boolean
    allowSeek: boolean
  } | null
  instructions: string[]
}

interface TestBriefBody {
  id: string
  slug: string
  title: string
  durationSeconds: number
  attemptCount: number
  inProgressAttemptId: string | null
  sections: TestBriefSectionBody[]
}

function briefBody(res: { body: unknown }): TestBriefBody {
  return res.body as TestBriefBody
}

/**
 * A published test carrying one section with an instruction, playback
 * caps and a real question -- so a test can assert that GET /tests/{slug}
 * renders the rules and instructions but never the question prompt or
 * choice label.
 */
async function insertPublishedTestWithSections(
  pool: PgPool,
  input: { slug: string; title: string },
): Promise<{
  testId: string
  versionId: string
  sectionId: string
  questionPrompt: string
  choiceLabel: string
}> {
  const testId = randomUUID()
  const versionId = randomUUID()
  const sectionId = randomUUID()
  const groupId = randomUUID()
  const questionId = randomUUID()
  const choiceId = randomUUID()
  const questionPrompt = "What does the boy want to do?"
  const choiceLabel = "Read a book"

  await pool.query(`INSERT INTO test (id, slug) VALUES ($1, $2)`, [
    testId,
    input.slug,
  ])
  await pool.query(
    `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
     VALUES ($1, $2, 1, $3, 3000)`,
    [versionId, testId, input.title],
  )
  await pool.query(
    `INSERT INTO test_section (
       id, test_version_id, ordinal, title, type, duration_seconds,
       navigation, allow_answer_change,
       default_max_plays, default_allow_pause, default_allow_seek
     ) VALUES ($1, $2, 1, 'Listening — Part 1', 'listening', 1500,
               'forward_only', false, 1, false, false)`,
    [sectionId, versionId],
  )
  await pool.query(
    `INSERT INTO section_instruction (test_section_id, ordinal, text)
     VALUES ($1, 1, 'Put your headphones on now.')`,
    [sectionId],
  )
  await pool.query(
    `INSERT INTO question_group (id, test_version_id, test_section_id, ordinal)
     VALUES ($1, $2, $3, 1)`,
    [groupId, versionId, sectionId],
  )
  await pool.query(
    `INSERT INTO question (
       id, test_version_id, question_group_id, question_key, ordinal, prompt, type, points
     ) VALUES ($1, $2, $3, 'q1', 1, $4, 'single_choice', 1)`,
    [questionId, versionId, groupId, questionPrompt],
  )
  await pool.query(
    `INSERT INTO choice (id, question_id, ordinal, label, is_correct)
     VALUES ($1, $2, 1, $3, true)`,
    [choiceId, questionId, choiceLabel],
  )
  await pool.query(
    `UPDATE test_version SET published_at = now() WHERE id = $1`,
    [versionId],
  )
  await pool.query(`UPDATE test SET current_version_id = $1 WHERE id = $2`, [
    versionId,
    testId,
  ])

  return { testId, versionId, sectionId, questionPrompt, choiceLabel }
}

/** A draft-only test: never published, so current_version_id stays null. */
async function insertDraftTest(
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
      .get("/api/tests")
      .expect(401)
  })

  it("is 404 for a valid token that never called POST /session", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-unprovisioned`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .get("/api/tests")
      .set("Authorization", `Bearer ${token}`)
      .expect(404)
  })

  it("lists a published test with this student's standing", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-listing`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    const pool = a.get<PgPool>(REQUEST_POOL)
    const { testId } = await insertPublishedTest(pool, {
      slug: `catalog-listing-${randomUUID()}`,
      title: "Catalog Listing Test",
    })

    const res = await request(a.http.getHttpServer() as App)
      .get("/api/tests")
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
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)
    const me = await request(a.http.getHttpServer() as App)
      .get("/api/me")
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
      .get("/api/tests")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    const card = body(res).tests.find((c) => c.id === testId)

    expect(card?.inProgressAttemptId).toBe(attemptId)
  })

  it("rejects an out-of-range limit with 400", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-bad-limit`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    await request(a.http.getHttpServer() as App)
      .get("/api/tests")
      .query({ limit: 51 })
      .set("Authorization", `Bearer ${token}`)
      .expect(400)

    await request(a.http.getHttpServer() as App)
      .get("/api/tests")
      .query({ limit: 0 })
      .set("Authorization", `Bearer ${token}`)
      .expect(400)
  })

  it("rejects an undecodable cursor with 400", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-bad-cursor`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    await request(a.http.getHttpServer() as App)
      .get("/api/tests")
      .query({ cursor: "not-a-valid-cursor!!" })
      .set("Authorization", `Bearer ${token}`)
      .expect(400)
  })
})

describe("GET /tests/{slug}", () => {
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

  it("returns sections, rules and instructions for a published test", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-brief`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    const pool = a.get<PgPool>(REQUEST_POOL)
    const slug = `catalog-brief-${randomUUID()}`
    const fixture = await insertPublishedTestWithSections(pool, {
      slug,
      title: "Brief Test",
    })

    const res = await request(a.http.getHttpServer() as App)
      .get(`/api/tests/${slug}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    const brief = briefBody(res)

    expect(brief.id).toBe(fixture.testId)
    expect(brief.slug).toBe(slug)
    expect(brief.title).toBe("Brief Test")
    expect(brief.durationSeconds).toBe(3000)
    expect(brief.attemptCount).toBe(0)
    expect(typeof brief.attemptCount).toBe("number")
    expect(brief.inProgressAttemptId).toBeNull()
    expect(brief.sections).toHaveLength(1)
    expect(brief.sections[0]?.id).toBe(fixture.sectionId)
    expect(brief.sections[0]?.type).toBe("listening")
    expect(brief.sections[0]?.questionCount).toBe(1)
  })

  it("carries NO question or choice text anywhere in the payload", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-brief-redaction`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    const pool = a.get<PgPool>(REQUEST_POOL)
    const slug = `catalog-brief-redaction-${randomUUID()}`
    const fixture = await insertPublishedTestWithSections(pool, {
      slug,
      title: "Redaction Test",
    })

    const res = await request(a.http.getHttpServer() as App)
      .get(`/api/tests/${slug}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    const serialized = JSON.stringify(res.body)

    expect(serialized).not.toContain(fixture.questionPrompt)
    expect(serialized).not.toContain(fixture.choiceLabel)
  })

  it("404s for an unpublished slug", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-brief-404`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    const pool = a.get<PgPool>(REQUEST_POOL)
    const draftSlug = `catalog-brief-draft-${randomUUID()}`

    await insertDraftTest(pool, {
      slug: draftSlug,
      title: "Will Not Be Published",
    })

    await request(a.http.getHttpServer() as App)
      .get(`/api/tests/${draftSlug}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404)

    await request(a.http.getHttpServer() as App)
      .get(`/api/tests/does-not-exist-${randomUUID()}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404)
  })

  it("carries each section's instructions in order and its playback rules", async () => {
    const a = ready()
    const token = await a.mint({
      sub: `${SUB}-brief-instructions`,
      email: EMAIL,
    })

    await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    const pool = a.get<PgPool>(REQUEST_POOL)
    const slug = `catalog-brief-instructions-${randomUUID()}`

    await insertPublishedTestWithSections(pool, {
      slug,
      title: "Instructions Test",
    })

    const res = await request(a.http.getHttpServer() as App)
      .get(`/api/tests/${slug}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    const [section] = briefBody(res).sections

    expect(section.navigation).toBe("forward_only")
    expect(section.allowAnswerChange).toBe(false)
    expect(section.instructions).toEqual(["Put your headphones on now."])
    expect(section.playback).toEqual({
      maxPlays: 1,
      allowPause: false,
      allowSeek: false,
    })
  })
})
