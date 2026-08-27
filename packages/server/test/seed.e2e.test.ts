import type { PgPool } from "@liam-public/node-postgres"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { seedPracticeTest } from "../../../scripts/seed-test.js"
import { JOB_POOL } from "../src/database/tokens.js"
import { createTestApp, type TestApp } from "./helpers/app.js"

interface SectionCardBody {
  type: string
  questionCount: number
}

interface TestCardBody {
  id: string
  slug: string
  title: string
  sections: SectionCardBody[]
}

interface CatalogBody {
  tests: TestCardBody[]
}

interface TestBriefSectionBody {
  id: string
  type: string
  questionCount: number
}

interface TestBriefBody {
  id: string
  slug: string
  title: string
  sections: TestBriefSectionBody[]
}

/** Mirrors openapi.yaml's `AttemptStart`, which is flat. */
interface AttemptStartBody {
  id: string
  attemptNumber: number
  status: string
  resumed: boolean
}

function catalogBody(res: { body: unknown }): CatalogBody {
  return res.body as CatalogBody
}

function briefBody(res: { body: unknown }): TestBriefBody {
  return res.body as TestBriefBody
}

function attemptBody(res: { body: unknown }): AttemptStartBody {
  return res.body as AttemptStartBody
}

const SUB = "google-oauth2|seed-test"
const EMAIL = "tom@example.com"

describe("seed-test", () => {
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

  it("seeds a real 40-question test and is safe to run twice", async () => {
    const a = ready()
    const pool = a.get<PgPool>(JOB_POOL)

    const first = await seedPracticeTest(pool)

    expect(first.alreadySeeded).toBe(false)
    expect(typeof first.testId).toBe("string")
    expect(typeof first.versionId).toBe("string")

    const second = await seedPracticeTest(pool)

    expect(second.alreadySeeded).toBe(true)
    expect(second.testId).toBe(first.testId)
    expect(second.versionId).toBe(first.versionId)

    // Re-running must never create a second test_version row for this
    // slug -- that is exactly the `test_version_one_draft` trap the seed
    // script's idempotence guard exists to avoid.
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM test_version tv
           JOIN test t ON t.id = tv.test_id
          WHERE t.slug = 'practice-test-01'`,
    )

    expect(rows[0].n).toBe("1")

    const token = await a.mint({ sub: SUB, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    const listRes = await request(a.http.getHttpServer() as App)
      .get("/api/tests")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    const card = catalogBody(listRes).tests.find(
      (t) => t.slug === "practice-test-01",
    )

    expect(card).toBeDefined()
    expect(card?.id).toBe(first.testId)

    const cardSections = card?.sections ?? []
    const listeningCard = cardSections.find((s) => s.type === "listening")
    const readingCard = cardSections.find((s) => s.type === "reading")

    expect(listeningCard?.questionCount).toBe(20)
    expect(readingCard?.questionCount).toBe(20)

    const briefRes = await request(a.http.getHttpServer() as App)
      .get("/api/tests/practice-test-01")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    const brief = briefBody(briefRes)

    expect(brief.id).toBe(first.testId)
    expect(brief.sections).toHaveLength(2)

    const totalQuestions = brief.sections.reduce(
      (n, s) => n + s.questionCount,
      0,
    )

    expect(totalQuestions).toBe(40)

    const attemptRes = await request(a.http.getHttpServer() as App)
      .post("/api/attempts")
      .set("Authorization", `Bearer ${token}`)
      .send({ slug: "practice-test-01" })
      .expect(201)

    const attempt = attemptBody(attemptRes)

    expect(attempt.status).toBe("in_progress")
    expect(attempt.resumed).toBe(false)
    expect(attempt.attemptNumber).toBe(1)
    expect(typeof attempt.id).toBe("string")
  }, 120_000)
})
