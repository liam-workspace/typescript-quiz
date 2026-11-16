import type { PgPool } from "@liam-workspace/node-postgres"
import {
  testDocumentSchema,
  type AdminOverview,
  type AdminQuestionPage,
  type AdminTestDetail,
  type AdminTestPage,
  type TestDocument,
} from "@pp/common"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { createTestApp, type TestApp } from "./helpers/app.js"

const SUB = "google-oauth2|admin-test"
const EMAIL = "tom@example.com"

/**
 * No stimulus, no media -- every check this suite needs (choice counts,
 * publish/export status codes) is expressible without a media_asset row,
 * and importing one is outside this task (POST /admin/media, a later task).
 */
function validDoc(slug: string): TestDocument {
  return testDocumentSchema.parse({
    title: "Admin E2E Test",
    slug,
    level: "primary-step-1",
    durationSeconds: 100,
    sections: [
      {
        title: "Listening — Part 1",
        type: "listening",
        durationSeconds: 100,
        navigation: "forward_only",
        allowAnswerChange: false,
        playback: null,
        instructions: [],
        groups: [
          {
            questions: [
              {
                questionKey: "q1",
                prompt: "A?",
                type: "single_choice",
                points: 1,
                choices: [
                  { label: "yes", isCorrect: true },
                  { label: "no", isCorrect: false },
                ],
              },
            ],
          },
        ],
      },
    ],
  })
}

describe("admin routes", () => {
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

  const readPaths = [
    "/api/admin/overview",
    "/api/admin/tests",
    "/api/admin/tests/00000000-0000-0000-0000-000000000000",
    "/api/admin/questions",
  ]

  it.each(readPaths)("GET %s requires a token", async (path) => {
    await request(ready().http.getHttpServer() as App)
      .get(path)
      .expect(401)
  })

  it.each(readPaths)(
    "GET %s refuses non-admins with admin_required",
    async (path) => {
      const a = ready()
      const token = await a.mint({ sub: `${SUB}-read-nonadmin`, email: EMAIL })
      const response = await request(a.http.getHttpServer() as App)
        .get(path)
        .set("Authorization", `Bearer ${token}`)
        .expect(403)

      expect(response.body).toMatchObject({
        type: "admin_required",
        status: 403,
      })
    },
  )

  it("returns overview counters to an admin", async () => {
    const a = ready()
    const token = await a.mint({
      sub: `${SUB}-overview`,
      email: EMAIL,
      isAdmin: true,
    })
    const response = await request(a.http.getHttpServer() as App)
      .get("/api/admin/overview")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
    const overview = response.body as AdminOverview

    const imported = await request(a.http.getHttpServer() as App)
      .post("/api/admin/tests/import")
      .set("Authorization", `Bearer ${token}`)
      .send(validDoc("overview-counters"))
      .expect(201)
    const { testId } = imported.body as { testId: string }
    const afterImport = await request(a.http.getHttpServer() as App)
      .get("/api/admin/overview")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
    expect(afterImport.body).toEqual({
      tests: {
        total: overview.tests.total + 1,
        drafts: overview.tests.drafts + 1,
        published: overview.tests.published,
      },
      attempts: overview.attempts,
      learners: overview.learners,
    })

    await request(a.http.getHttpServer() as App)
      .post(`/api/admin/tests/${testId}/publish`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
    const afterPublish = await request(a.http.getHttpServer() as App)
      .get("/api/admin/overview")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
    expect(afterPublish.body).toEqual({
      tests: {
        total: overview.tests.total + 1,
        drafts: overview.tests.drafts,
        published: overview.tests.published + 1,
      },
      attempts: overview.attempts,
      learners: overview.learners,
    })
  })

  it("filters and pages the latest catalogue version and loads draft details", async () => {
    const a = ready()
    const token = await a.mint({
      sub: `${SUB}-catalogue`,
      email: EMAIL,
      isAdmin: true,
    })
    const auth = `Bearer ${token}`
    const ids: string[] = []
    for (const [slug, title] of [
      ["read-a", "Catalogue A"],
      ["read-b", "Catalogue B"],
    ]) {
      // eslint-disable-next-line no-await-in-loop -- Supertest binds/closes this shared server per request.
      const imported = await request(a.http.getHttpServer() as App)
        .post("/api/admin/tests/import")
        .set("Authorization", auth)
        .send({ ...validDoc(slug), title })
        .expect(201)
      ids.push((imported.body as { testId: string }).testId)
    }

    const firstResponse = await request(a.http.getHttpServer() as App)
      .get("/api/admin/tests")
      .query({ search: " catalogue ", status: "draft", limit: 1 })
      .set("Authorization", auth)
      .expect(200)
    const first = firstResponse.body as AdminTestPage
    expect(first.items).toMatchObject([
      {
        id: ids[0],
        title: "Catalogue A",
        status: "draft",
        currentVersionId: null,
      },
    ])
    expect(first.nextCursor).toEqual(expect.any(String))

    const secondResponse = await request(a.http.getHttpServer() as App)
      .get("/api/admin/tests")
      .query({
        search: "catalogue",
        status: "draft",
        limit: 1,
        cursor: first.nextCursor,
      })
      .set("Authorization", auth)
      .expect(200)
    const second = secondResponse.body as AdminTestPage
    expect(second.items).toMatchObject([{ id: ids[1], title: "Catalogue B" }])
    expect(second.nextCursor).toBeNull()

    const detailResponse = await request(a.http.getHttpServer() as App)
      .get(`/api/admin/tests/${ids[0]}`)
      .set("Authorization", auth)
      .expect(200)
    const detail = detailResponse.body as AdminTestDetail
    expect(detail).toMatchObject({
      id: ids[0],
      status: "draft",
      durationSeconds: 100,
      description: null,
      sections: [{ title: "Listening — Part 1", questionCount: 1 }],
    })
    expect(detail.sections[0].id).toEqual(expect.any(String))

    const published = await request(a.http.getHttpServer() as App)
      .get("/api/admin/tests")
      .query({ search: "catalogue", status: "published" })
      .set("Authorization", auth)
      .expect(200)
    expect(published.body).toEqual({ items: [], nextCursor: null })
  })

  it("searches and pages questions with real editable choice IDs", async () => {
    const a = ready()
    const token = await a.mint({
      sub: `${SUB}-questions`,
      email: EMAIL,
      isAdmin: true,
    })
    const doc = validDoc("question-search")
    const [group] = doc.sections[0].groups
    group.questions = [
      { ...group.questions[0], questionKey: "q1", prompt: "Searchable Alpha?" },
      { ...group.questions[0], questionKey: "q2", prompt: "Searchable Beta?" },
    ]
    const imported = await request(a.http.getHttpServer() as App)
      .post("/api/admin/tests/import")
      .set("Authorization", `Bearer ${token}`)
      .send(doc)
      .expect(201)
    const { testId } = imported.body as { testId: string }

    const firstResponse = await request(a.http.getHttpServer() as App)
      .get("/api/admin/questions")
      .query({ testId, search: " searchable ", limit: 1 })
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
    const first = firstResponse.body as AdminQuestionPage
    expect(first.items).toMatchObject([
      {
        prompt: "Searchable Alpha?",
        choices: [
          { label: "yes", isCorrect: true },
          { label: "no", isCorrect: false },
        ],
      },
    ])
    expect(first.items[0].id).toEqual(expect.any(String))
    expect(first.items[0].choices[0].id).toEqual(expect.any(String))
    expect(first.nextCursor).toEqual(expect.any(String))

    const secondResponse = await request(a.http.getHttpServer() as App)
      .get("/api/admin/questions")
      .query({
        testId,
        search: "searchable",
        limit: 1,
        cursor: first.nextCursor,
      })
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
    const second = secondResponse.body as AdminQuestionPage
    expect(second.items).toMatchObject([{ prompt: "Searchable Beta?" }])
    expect(second.items[0].id).not.toBe(first.items[0].id)
    expect(second.nextCursor).toBeNull()

    const absent = await request(a.http.getHttpServer() as App)
      .get("/api/admin/questions")
      .query({ testId: "00000000-0000-0000-0000-000000000000" })
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
    expect(absent.body).toEqual({ items: [], nextCursor: null })
  })

  it.each(["/api/admin/tests", "/api/admin/questions"])(
    "GET %s bounds pagination and rejects malformed filters/cursors",
    async (path) => {
      const a = ready()
      const token = await a.mint({
        sub: `${SUB}-read-validation`,
        email: EMAIL,
        isAdmin: true,
      })

      for (const limit of ["0", "101", "1.5", "nope", "", "Infinity"]) {
        // eslint-disable-next-line no-await-in-loop -- Supertest binds/closes this shared server per request.
        await request(a.http.getHttpServer() as App)
          .get(path)
          .query({ limit })
          .set("Authorization", `Bearer ${token}`)
          .expect(400)
      }
      await request(a.http.getHttpServer() as App)
        .get(path)
        .query({ limit: 100 })
        .set("Authorization", `Bearer ${token}`)
        .expect(200)
      for (const query of [
        { cursor: "invalid" },
        { cursor: "" },
        { search: "x".repeat(201) },
      ]) {
        // eslint-disable-next-line no-await-in-loop -- Supertest binds/closes this shared server per request.
        await request(a.http.getHttpServer() as App)
          .get(path)
          .query(query)
          .set("Authorization", `Bearer ${token}`)
          .expect(400)
      }
      const query = path.endsWith("tests")
        ? { status: "unknown" }
        : { testId: "not-a-uuid" }
      await request(a.http.getHttpServer() as App)
        .get(path)
        .query(query)
        .set("Authorization", `Bearer ${token}`)
        .expect(400)
    },
  )

  it("returns test_not_found for missing or malformed test IDs", async () => {
    const a = ready()
    const token = await a.mint({
      sub: `${SUB}-read-missing`,
      email: EMAIL,
      isAdmin: true,
    })
    for (const id of ["00000000-0000-0000-0000-000000000000", "not-a-uuid"]) {
      // eslint-disable-next-line no-await-in-loop -- Supertest binds/closes this shared server per request.
      const response = await request(a.http.getHttpServer() as App)
        .get(`/api/admin/tests/${id}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(404)
      expect(response.body).toMatchObject({
        type: "test_not_found",
        status: 404,
      })
    }
  })

  it("POST /admin/tests/import is 401 without a token", async () => {
    const a = ready()

    await request(a.http.getHttpServer() as App)
      .post("/api/admin/tests/import")
      .send(validDoc("import-401"))
      .expect(401)
  })

  it("POST /admin/tests/import is 403 for a non-admin token", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-nonadmin`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/api/admin/tests/import")
      .set("Authorization", `Bearer ${token}`)
      .send(validDoc("import-403"))
      .expect(403)
  })

  it("is 201 for an admin token and creates a draft", async () => {
    const a = ready()
    const token = await a.mint({
      sub: `${SUB}-import-ok`,
      email: EMAIL,
      isAdmin: true,
    })

    const res = await request(a.http.getHttpServer() as App)
      .post("/api/admin/tests/import")
      .set("Authorization", `Bearer ${token}`)
      .send(validDoc("import-201"))
      .expect(201)

    const created = res.body as {
      testId: string
      versionId: string
      version: number
    }

    expect(typeof created.testId).toBe("string")
    expect(typeof created.versionId).toBe("string")
    expect(created.version).toBe(1)
  })

  it("is 400 with the zod issues for an invalid document", async () => {
    const a = ready()
    const token = await a.mint({
      sub: `${SUB}-import-bad`,
      email: EMAIL,
      isAdmin: true,
    })

    const res = await request(a.http.getHttpServer() as App)
      .post("/api/admin/tests/import")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Missing everything else" })
      .expect(400)

    const problem = res.body as { issues: unknown[] }

    expect(Array.isArray(problem.issues)).toBe(true)
    expect(problem.issues.length).toBeGreaterThan(0)
  })

  it("POST /admin/tests/{testId}/publish is 403 for a non-admin token", async () => {
    const a = ready()
    const adminToken = await a.mint({
      sub: `${SUB}-publish-403-admin`,
      email: EMAIL,
      isAdmin: true,
    })
    const imported = await request(a.http.getHttpServer() as App)
      .post("/api/admin/tests/import")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validDoc("publish-403"))
      .expect(201)
    const { testId } = imported.body as { testId: string }

    const nonAdminToken = await a.mint({
      sub: `${SUB}-publish-403-nonadmin`,
      email: EMAIL,
    })

    await request(a.http.getHttpServer() as App)
      .post(`/api/admin/tests/${testId}/publish`)
      .set("Authorization", `Bearer ${nonAdminToken}`)
      .expect(403)
  })

  it("publishes a valid draft with 200 and stamps publishedAt", async () => {
    const a = ready()
    const token = await a.mint({
      sub: `${SUB}-publish-ok`,
      email: EMAIL,
      isAdmin: true,
    })
    const imported = await request(a.http.getHttpServer() as App)
      .post("/api/admin/tests/import")
      .set("Authorization", `Bearer ${token}`)
      .send(validDoc("publish-200"))
      .expect(201)
    const { testId, versionId } = imported.body as {
      testId: string
      versionId: string
    }

    const res = await request(a.http.getHttpServer() as App)
      .post(`/api/admin/tests/${testId}/publish`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    const published = res.body as {
      testId: string
      versionId: string
      version: number
      publishedAt: string
    }

    expect(published.testId).toBe(testId)
    expect(published.versionId).toBe(versionId)
    expect(published.version).toBe(1)
    expect(published.publishedAt).not.toBeNull()
  })

  it("refuses an invalid draft with 422, naming the violation, and leaves it a draft", async () => {
    const a = ready()
    const token = await a.mint({
      sub: `${SUB}-publish-422`,
      email: EMAIL,
      isAdmin: true,
    })

    const imported = await request(a.http.getHttpServer() as App)
      .post("/api/admin/tests/import")
      .set("Authorization", `Bearer ${token}`)
      .send(validDoc("publish-422"))
      .expect(201)
    const { testId, versionId } = imported.body as {
      testId: string
      versionId: string
    }

    // `testDocumentSchema` would refuse a one-choice question at import
    // time, so the invalid shape is built AFTER import -- corrupting the
    // row the same way a manual psql session or the seed script could,
    // which is exactly the path publication's re-verification exists to
    // catch.
    const pool = a.get<PgPool>(REQUEST_POOL)

    await pool.query(
      `DELETE FROM choice WHERE question_id = (
         SELECT id FROM question WHERE test_version_id = $1 LIMIT 1
       ) AND ordinal = 2`,
      [versionId],
    )

    const res = await request(a.http.getHttpServer() as App)
      .post(`/api/admin/tests/${testId}/publish`)
      .set("Authorization", `Bearer ${token}`)
      .expect(422)

    const problem = res.body as {
      violations: Array<{ rule: string; questionId?: string; detail: string }>
    }

    expect(problem.violations).toHaveLength(1)
    expect(problem.violations[0].rule).toBe("too_few_choices")
    expect(typeof problem.violations[0].questionId).toBe("string")

    const { rows } = await pool.query<{ published_at: string | null }>(
      `SELECT published_at FROM test_version WHERE id = $1`,
      [versionId],
    )

    expect(rows[0].published_at).toBeNull()
  })

  it("POST /admin/tests/{testId}/publish is 404 for a test with no draft", async () => {
    const a = ready()
    const token = await a.mint({
      sub: `${SUB}-publish-404`,
      email: EMAIL,
      isAdmin: true,
    })

    await request(a.http.getHttpServer() as App)
      .post("/api/admin/tests/00000000-0000-0000-0000-000000000000/publish")
      .set("Authorization", `Bearer ${token}`)
      .expect(404)
  })

  it("GET /admin/tests/{testId}/export is 403 for a non-admin token", async () => {
    const a = ready()
    const adminToken = await a.mint({
      sub: `${SUB}-export-403-admin`,
      email: EMAIL,
      isAdmin: true,
    })
    const imported = await request(a.http.getHttpServer() as App)
      .post("/api/admin/tests/import")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validDoc("export-403"))
      .expect(201)
    const { testId } = imported.body as { testId: string }

    const nonAdminToken = await a.mint({
      sub: `${SUB}-export-403-nonadmin`,
      email: EMAIL,
    })

    await request(a.http.getHttpServer() as App)
      .get(`/api/admin/tests/${testId}/export`)
      .set("Authorization", `Bearer ${nonAdminToken}`)
      .expect(403)
  })

  it("GET /admin/tests/{testId}/export is 404 before the draft is published", async () => {
    const a = ready()
    const token = await a.mint({
      sub: `${SUB}-export-404`,
      email: EMAIL,
      isAdmin: true,
    })
    const imported = await request(a.http.getHttpServer() as App)
      .post("/api/admin/tests/import")
      .set("Authorization", `Bearer ${token}`)
      .send(validDoc("export-404"))
      .expect(201)
    const { testId } = imported.body as { testId: string }

    await request(a.http.getHttpServer() as App)
      .get(`/api/admin/tests/${testId}/export`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404)
  })

  it("round-trips import, publish, export -- the export deep-equals the import, isCorrect included", async () => {
    const a = ready()
    const token = await a.mint({
      sub: `${SUB}-roundtrip`,
      email: EMAIL,
      isAdmin: true,
    })
    const doc = validDoc("roundtrip")

    const imported = await request(a.http.getHttpServer() as App)
      .post("/api/admin/tests/import")
      .set("Authorization", `Bearer ${token}`)
      .send(doc)
      .expect(201)
    const { testId } = imported.body as { testId: string }

    await request(a.http.getHttpServer() as App)
      .post(`/api/admin/tests/${testId}/publish`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    const exported = await request(a.http.getHttpServer() as App)
      .get(`/api/admin/tests/${testId}/export`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    expect(exported.body).toEqual(doc)

    const body = exported.body as TestDocument

    expect(body.sections[0].groups[0].questions[0].choices[0]).toHaveProperty(
      "isCorrect",
    )
  })
})
