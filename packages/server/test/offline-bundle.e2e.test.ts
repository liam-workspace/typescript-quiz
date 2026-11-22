import type { PgPool } from "@liam-workspace/node-postgres"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { verifyMediaSignature } from "../src/media/media-signing.js"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { createTestApp, type TestApp } from "./helpers/app.js"
import { seedOfflineFixture } from "./helpers/offline-fixture.js"

const NOW = new Date("2026-11-22T12:00:00.000Z")
const SECRET = "test-media-signing-secret"

interface BundleBody {
  slug: string
  testVersionId: string
  version: number
  sections: Array<{
    id: string
    playback: { maxPlays: number | null } | null
    groups: Array<{
      questions: Array<{ choices: Array<Record<string, unknown>> }>
    }>
  }>
  media: Array<{
    key: string
    stimulusId: string
    capped: boolean
    bytes: number
    url: string
  }>
  totalBytes: number
  urlsExpireAt: string
}

/**
 * Every key anywhere in the body, compared with the fields the runner
 * envelope omits. `allowAnswerChange` is a legitimate section rule, hence the
 * explicit deny-list rather than a regex on "answer".
 */
const FORBIDDEN_KEYS = [
  "isCorrect",
  "is_correct",
  "correct",
  "correctChoiceIds",
  "correctChoiceId",
  "answerKey",
  "solution",
  "solutionBlocks",
  "solution_blocks",
  "explanation",
  "explanationBlocks",
  "afterTestSolution",
]

function collectKeys(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, into)
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key)
      collectKeys(child, into)
    }
  }

  return into
}

function expectNoAnswerKeys(body: unknown): void {
  const keys = collectKeys(body, new Set())

  for (const forbidden of FORBIDDEN_KEYS) {
    expect(keys.has(forbidden), `body carries "${forbidden}"`).toBe(false)
  }

  const text = JSON.stringify(body)

  expect(text).not.toContain("isCorrect")
  expect(text).not.toContain("is_correct")
}

function choicesOf(body: BundleBody): Array<Record<string, unknown>> {
  const questions = body.sections
    .flatMap((section) => section.groups)
    .flatMap((group) => group.questions)

  return questions.flatMap((question) => question.choices)
}

describe("GET /tests/:slug/offline-bundle", () => {
  let app: TestApp | undefined = undefined

  beforeAll(async () => {
    app = await createTestApp({ now: NOW })
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

  async function studentToken(a: TestApp, sub: string): Promise<string> {
    const token = await a.mint({ sub, email: "kid@example.com" })

    await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    return token
  }

  it("returns content without answer keys, and signs capped audio for download", async () => {
    const a = ready()
    const fx = await seedOfflineFixture(a, "bundle-happy")
    const token = await studentToken(a, "bundle-student-1")
    const res = await request(a.http.getHttpServer() as App)
      .get("/api/tests/bundle-happy/offline-bundle")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
    const body = res.body as BundleBody

    expect(body.testVersionId).toBe(fx.versionId)
    expect(body.sections).toHaveLength(2)
    expect(body.sections[0]?.playback?.maxPlays).toBe(1)
    expectNoAnswerKeys(body)
    expect(body.totalBytes).toBe(2048)

    expect(body.media).toHaveLength(1)

    const [media] = body.media

    expect(media.key).toBe(fx.mediaFilename)
    expect(media.capped).toBe(true)

    const url = new URL(media.url, "http://x")

    expect(url.pathname).toBe(`/api/media/${fx.mediaFilename}`)
    expect(
      verifyMediaSignature(
        fx.mediaFilename,
        url.searchParams.get("exp") ?? undefined,
        url.searchParams.get("sig") ?? undefined,
        SECRET,
        NOW,
      ),
    ).toBe(true)
    expect(Date.parse(body.urlsExpireAt)).toBeGreaterThan(NOW.getTime())
  })

  it("serves choices as id and label only (no key material)", async () => {
    const a = ready()

    await seedOfflineFixture(a, "bundle-choices")

    const token = await studentToken(a, "bundle-student-3")
    const res = await request(a.http.getHttpServer() as App)
      .get("/api/tests/bundle-choices/offline-bundle")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
    const body = res.body as BundleBody
    const choices = choicesOf(body)

    expect(choices).toHaveLength(6)

    for (const choice of choices) {
      expect(Object.keys(choice).sort()).toEqual(["id", "label"])
    }
  })

  it("404s for an unknown slug and 401s without a token", async () => {
    const a = ready()
    const token = await studentToken(a, "bundle-student-2")

    await request(a.http.getHttpServer() as App)
      .get("/api/tests/does-not-exist/offline-bundle")
      .set("Authorization", `Bearer ${token}`)
      .expect(404)
    await request(a.http.getHttpServer() as App)
      .get("/api/tests/bundle-happy/offline-bundle")
      .expect(401)
  })

  it("404s for a never-published test, same as GET /tests/:slug", async () => {
    const a = ready()
    const token = await studentToken(a, "bundle-student-4")
    const pool = a.get<PgPool>(REQUEST_POOL)
    const testId = randomUUID()

    await pool.query(
      `INSERT INTO test (id, slug) VALUES ($1, 'bundle-draft')`,
      [testId],
    )
    await pool.query(
      `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
       VALUES ($1, $2, 1, 'Draft', 1000)`,
      [randomUUID(), testId],
    )

    const res = await request(a.http.getHttpServer() as App)
      .get("/api/tests/bundle-draft/offline-bundle")
      .set("Authorization", `Bearer ${token}`)
      .expect(404)

    expect((res.body as { type: string }).type).toContain("test_not_found")
  })

  it("404s a valid token whose student was never provisioned", async () => {
    const a = ready()
    const token = await a.mint({
      sub: "bundle-unprovisioned",
      email: "ghost@example.com",
    })

    await request(a.http.getHttpServer() as App)
      .get("/api/tests/bundle-happy/offline-bundle")
      .set("Authorization", `Bearer ${token}`)
      .expect(404)
  })
})
