import type { PgPool } from "@liam-workspace/node-postgres"
import {
  testDocumentSchema,
  type AdminAttemptDetail,
  type AdminLearnerPage,
  type AdminResultPage,
  type AdminResultRollups,
  type AdminOverview,
  type AdminQuestion,
  type AdminQuestionPage,
  type AdminTestDetail,
  type AdminTestPage,
  type TestDocument,
} from "@pp/common"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { ImportResult } from "../src/admin/admin.service.js"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { createTestApp, type TestApp } from "./helpers/app.js"
import { provisionStudent, seedWriteFixture } from "./helpers/write-fixture.js"

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
  let failAuditWrites = false

  beforeAll(async () => {
    app = await createTestApp({
      beforePoolQuery: (sql) => {
        if (failAuditWrites && sql.includes("INSERT INTO admin_audit_log")) {
          throw new Error("Simulated audit persistence failure")
        }

        return Promise.resolve()
      },
    })
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

  async function draftFixture(slug: string, doc = validDoc(slug)) {
    const a = ready()
    const adminSubject = `${SUB}-${slug}`
    const token = await a.mint({
      sub: adminSubject,
      email: EMAIL,
      isAdmin: true,
    })
    const imported = await request(a.http.getHttpServer() as App)
      .post("/api/admin/tests/import")
      .set("Authorization", `Bearer ${token}`)
      .send(doc)
      .expect(201)
    const { testId, versionId } = imported.body as ImportResult
    const questions = await request(a.http.getHttpServer() as App)
      .get("/api/admin/questions")
      .query({ testId })
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
    const [question] = (questions.body as AdminQuestionPage).items

    return {
      token,
      adminSubject,
      testId,
      versionId,
      question,
      path: `/api/admin/drafts/${versionId}/questions/${question.id}`,
      pool: a.get<PgPool>(REQUEST_POOL),
    }
  }

  async function questionAudits(pool: PgPool, questionId: string) {
    const audit = await pool.query<{
      admin_subject: string
      action: string
      resource_type: string
      resource_id: string
      metadata: { versionId: string }
    }>(
      "SELECT admin_subject, action, resource_type, resource_id, metadata FROM admin_audit_log WHERE resource_id = $1",
      [questionId],
    )

    return audit.rows
  }

  it("edits a draft prompt and stable choices, then appends its audit row", async () => {
    const f = await draftFixture("draft-edit-ok")
    const choices = [...f.question.choices].reverse().map((choice, index) => ({
      ...choice,
      label: `Edited ${index + 1}`,
      isCorrect: index === 0,
    }))
    const response = await request(ready().http.getHttpServer() as App)
      .patch(f.path)
      .set("Authorization", `Bearer ${f.token}`)
      .send({ prompt: "  Edited prompt?  ", choices })
      .expect(200)
    const updated = response.body as AdminQuestion
    expect(updated).toEqual({
      id: f.question.id,
      prompt: "Edited prompt?",
      choices,
    })
    const persisted = await request(ready().http.getHttpServer() as App)
      .get("/api/admin/questions")
      .query({ testId: f.testId })
      .set("Authorization", `Bearer ${f.token}`)
      .expect(200)
    expect((persisted.body as AdminQuestionPage).items).toEqual([updated])
    expect(await questionAudits(f.pool, f.question.id)).toEqual([
      {
        admin_subject: f.adminSubject,
        action: "draft_question_updated",
        resource_type: "question",
        resource_id: f.question.id,
        metadata: { versionId: f.versionId },
      },
    ])
  })

  it("rejects published edits without changing the export or appending audit", async () => {
    const f = await draftFixture("draft-edit-published")
    await request(ready().http.getHttpServer() as App)
      .post(`/api/admin/tests/${f.testId}/publish`)
      .set("Authorization", `Bearer ${f.token}`)
      .expect(200)
    const response = await request(ready().http.getHttpServer() as App)
      .patch(f.path)
      .set("Authorization", `Bearer ${f.token}`)
      .send({ prompt: "Must not persist" })
      .expect(409)
    expect(response.body).toMatchObject({
      type: "published_version_immutable",
      status: 409,
    })
    const exported = await request(ready().http.getHttpServer() as App)
      .get(`/api/admin/tests/${f.testId}/export`)
      .set("Authorization", `Bearer ${f.token}`)
      .expect(200)
    expect(exported.body).toEqual(validDoc("draft-edit-published"))
    expect(await questionAudits(f.pool, f.question.id)).toEqual([])
  })

  it("rejects question/version mismatches without mutation or audit", async () => {
    const f = await draftFixture("draft-edit-mismatch")
    const other = await draftFixture("draft-edit-other")
    const response = await request(ready().http.getHttpServer() as App)
      .patch(`/api/admin/drafts/${other.versionId}/questions/${f.question.id}`)
      .set("Authorization", `Bearer ${f.token}`)
      .send({ prompt: "Must not persist" })
      .expect(404)
    expect(response.body).toMatchObject({
      type: "draft_question_not_found",
      status: 404,
    })
    const stored = await f.pool.query<{ prompt: string }>(
      "SELECT prompt FROM question WHERE id = $1",
      [f.question.id],
    )
    expect(stored.rows[0].prompt).toBe(f.question.prompt)
    expect(await questionAudits(f.pool, f.question.id)).toEqual([])
  })

  it("requires authentication and admin permission for draft edits", async () => {
    const f = await draftFixture("draft-edit-denied")
    const nonAdmin = await ready().mint({
      sub: `${SUB}-draft-editor-denied`,
      email: EMAIL,
    })
    await request(ready().http.getHttpServer() as App)
      .patch(f.path)
      .send({ prompt: "Must not persist" })
      .expect(401)
    const response = await request(ready().http.getHttpServer() as App)
      .patch(f.path)
      .set("Authorization", `Bearer ${nonAdmin}`)
      .send({ prompt: "Must not persist" })
      .expect(403)
    expect(response.body).toMatchObject({ type: "admin_required", status: 403 })
    expect(await questionAudits(f.pool, f.question.id)).toEqual([])
    const stored = await f.pool.query<{ prompt: string }>(
      "SELECT prompt FROM question WHERE id = $1",
      [f.question.id],
    )
    expect(stored.rows[0].prompt).toBe(f.question.prompt)
  })

  it.each([
    {},
    { prompt: " " },
    { prompt: 123 },
    { prompt: "Allowed", points: 3 },
    { choices: [] },
    {
      choices: [
        { id: "x", label: "Yes", isCorrect: true, extra: true },
        { id: "y", label: "No", isCorrect: false },
      ],
    },
  ])("validates draft patch bodies strictly: %j", async (body) => {
    const f = await draftFixture(`draft-edit-invalid-${crypto.randomUUID()}`)
    const response = await request(ready().http.getHttpServer() as App)
      .patch(f.path)
      .set("Authorization", `Bearer ${f.token}`)
      .send(body)
      .expect(400)
    expect(response.body).toMatchObject({
      type: "invalid_draft_question_patch",
      status: 400,
    })
    expect(await questionAudits(f.pool, f.question.id)).toEqual([])
  })

  it("rejects malformed or missing draft paths without audit", async () => {
    const f = await draftFixture("draft-edit-invalid-path")
    const missing = "00000000-0000-0000-0000-000000000000"
    for (const [versionId, questionId] of [
      ["not-a-uuid", f.question.id],
      [f.versionId, "not-a-uuid"],
      [missing, f.question.id],
      [f.versionId, missing],
    ]) {
      // eslint-disable-next-line no-await-in-loop -- Supertest binds/closes this shared server per request.
      const response = await request(ready().http.getHttpServer() as App)
        .patch(`/api/admin/drafts/${versionId}/questions/${questionId}`)
        .set("Authorization", `Bearer ${f.token}`)
        .send({ prompt: "Must not persist" })
        .expect(404)
      expect(response.body).toMatchObject({
        type: "draft_question_not_found",
        status: 404,
      })
    }
    expect(await questionAudits(f.pool, f.question.id)).toEqual([])
  })

  it("rejects changed choice identities without committing a prompt or audit", async () => {
    const f = await draftFixture("draft-edit-invalid-choices")
    const response = await request(ready().http.getHttpServer() as App)
      .patch(f.path)
      .set("Authorization", `Bearer ${f.token}`)
      .send({
        prompt: "Must not persist",
        choices: f.question.choices.map((choice) => ({
          ...choice,
          id: crypto.randomUUID(),
        })),
      })
      .expect(400)
    expect(response.body).toMatchObject({
      type: "invalid_draft_choices",
      status: 400,
    })
    const stored = await f.pool.query<{ prompt: string }>(
      "SELECT prompt FROM question WHERE id = $1",
      [f.question.id],
    )
    expect(stored.rows[0].prompt).toBe(f.question.prompt)
    expect(await questionAudits(f.pool, f.question.id)).toEqual([])
  })

  it.each(["prompt", "choice"] as const)(
    "rejects ambiguous rich %s edits without mutation or audit",
    async (target) => {
      const f = await draftFixture(`draft-edit-ambiguous-${target}`)
      const blocks = [
        { kind: "text", value: "First fragment" },
        { kind: "text", value: "Second fragment" },
      ]

      if (target === "prompt") {
        await f.pool.query(
          "UPDATE question SET prompt_blocks = $2::jsonb WHERE id = $1",
          [f.question.id, JSON.stringify(blocks)],
        )
      } else {
        await f.pool.query(
          "UPDATE choice SET label_blocks = $2::jsonb WHERE id = $1",
          [f.question.choices[0].id, JSON.stringify(blocks)],
        )
      }

      const snapshot = async () => ({
        question: (
          await f.pool.query(
            "SELECT prompt, prompt_blocks FROM question WHERE id = $1",
            [f.question.id],
          )
        ).rows,
        choices: (
          await f.pool.query(
            "SELECT id, label, label_blocks, ordinal, is_correct FROM choice WHERE question_id = $1 ORDER BY ordinal",
            [f.question.id],
          )
        ).rows,
      })
      const before = await snapshot()
      const response = await request(ready().http.getHttpServer() as App)
        .patch(f.path)
        .set("Authorization", `Bearer ${f.token}`)
        .send({
          prompt: "Must not persist",
          choices: [...f.question.choices].reverse().map((choice) => ({
            ...choice,
            label: `Edited ${choice.label}`,
            isCorrect: !choice.isCorrect,
          })),
        })
        .expect(409)

      expect(response.body).toMatchObject({
        type: "ambiguous_draft_text",
        title:
          "Flat editing cannot safely modify rich content with multiple text blocks.",
        status: 409,
      })
      expect(await snapshot()).toEqual(before)
      expect(await questionAudits(f.pool, f.question.id)).toEqual([])
    },
  )

  it("returns 500 when the post-commit audit fails, with the edit already committed", async () => {
    const f = await draftFixture("draft-edit-audit-failure")
    failAuditWrites = true

    try {
      const response = await request(ready().http.getHttpServer() as App)
        .patch(f.path)
        .set("Authorization", `Bearer ${f.token}`)
        .send({ prompt: "Committed before audit failure" })
        .expect(500)
      expect(response.body).not.toHaveProperty("choices")
      expect(response.body).not.toHaveProperty("prompt")
    } finally {
      failAuditWrites = false
    }

    const stored = await f.pool.query<{ prompt: string }>(
      "SELECT prompt FROM question WHERE id = $1",
      [f.question.id],
    )
    expect(stored.rows[0].prompt).toBe("Committed before audit failure")
    expect(await questionAudits(f.pool, f.question.id)).toEqual([])
  })

  const readPaths = [
    "/api/admin/overview",
    "/api/admin/tests",
    "/api/admin/tests/00000000-0000-0000-0000-000000000000",
    "/api/admin/questions",
    "/api/admin/results",
    "/api/admin/results/rollups",
    "/api/admin/results/attempts/00000000-0000-0000-0000-000000000000",
    "/api/admin/learners",
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

  async function completedAttempt(subject: string) {
    const a = ready()
    const pool = a.get<PgPool>(REQUEST_POOL)
    const student = await provisionStudent(a, subject)
    const fixture = await seedWriteFixture(pool, student.studentId)
    await request(a.http.getHttpServer() as App)
      .post(`/api/attempts/${fixture.attemptId}/submit`)
      .set("Authorization", `Bearer ${student.token}`)
      .send({
        clientInstanceId: "admin-results-device",
        responses: [
          {
            questionId: fixture.appliedQuestionId,
            seq: 1,
            selectedChoiceIds: [fixture.choiceIds[0]],
          },
        ],
      })
      .expect(201)

    return { pool, student, fixture }
  }

  it("lists answer-free aggregate results with learner/test filters and pagination", async () => {
    const a = ready()
    const { pool, student, fixture } = await completedAttempt(
      `${SUB}-results-owner`,
    )
    const second = await seedWriteFixture(pool, student.studentId)
    await request(a.http.getHttpServer() as App)
      .post(`/api/attempts/${second.attemptId}/submit`)
      .set("Authorization", `Bearer ${student.token}`)
      .send({
        clientInstanceId: "second-admin-result",
        responses: [
          {
            questionId: second.appliedQuestionId,
            seq: 1,
            selectedChoiceIds: [second.choiceIds[1]],
          },
        ],
      })
      .expect(201)
    const admin = await a.mint({
      sub: `${SUB}-results`,
      email: EMAIL,
      isAdmin: true,
    })
    const firstResponse = await request(a.http.getHttpServer() as App)
      .get("/api/admin/results")
      .query({ learnerId: student.studentId, limit: 1 })
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)
    const first = firstResponse.body as AdminResultPage
    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).toEqual(expect.any(String))
    const nextResponse = await request(a.http.getHttpServer() as App)
      .get("/api/admin/results")
      .query({
        learnerId: student.studentId,
        limit: 1,
        cursor: first.nextCursor,
      })
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)
    const next = nextResponse.body as AdminResultPage
    expect(next.items).toHaveLength(1)
    expect(next.nextCursor).toBeNull()
    const results = [...first.items, ...next.items]
    expect(results.map((item) => item.attemptId).sort()).toEqual(
      [fixture.attemptId, second.attemptId].sort(),
    )
    const result = results.find((item) => item.attemptId === fixture.attemptId)

    if (!result) {
      throw new Error("Expected the completed attempt in the results page")
    }

    expect(result).toMatchObject({
      learnerId: student.studentId,
      score: 1,
      maxScore: 2,
    })
    expect(Object.keys(result).sort()).toEqual(
      [
        "attemptId",
        "testId",
        "testTitle",
        "learnerId",
        "score",
        "maxScore",
        "completedAt",
      ].sort(),
    )
    const filtered = await request(a.http.getHttpServer() as App)
      .get("/api/admin/results")
      .query({ learnerId: student.studentId, testId: result.testId })
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)
    expect(filtered.body).toEqual({ items: [result], nextCursor: null })
    expect(JSON.stringify(results)).not.toContain(fixture.choiceIds[0])
  })

  it("returns de-identified rollups with a test filter and a per-dimension limit", async () => {
    const a = ready()
    const slug = "rollup-limits"
    const doc = validDoc(slug)
    const [group] = doc.sections[0].groups
    const [template] = group.questions
    group.questions = Array.from({ length: 21 }, (_, index) => ({
      ...template,
      questionKey: `question-${index + 1}`,
    }))
    const f = await draftFixture(slug, doc)
    const http = a.http.getHttpServer() as App
    await request(http)
      .post(`/api/admin/tests/${f.testId}/publish`)
      .set("Authorization", `Bearer ${f.token}`)
      .expect(200)
    const student = await provisionStudent(a, `${SUB}-rollup-owner`)
    const start = await request(http)
      .post("/api/attempts")
      .set("Authorization", `Bearer ${student.token}`)
      .send({ slug })
      .expect(201)
    const { id: attemptId } = start.body as { id: string }
    await request(http)
      .post(`/api/attempts/${attemptId}/submit`)
      .set("Authorization", `Bearer ${student.token}`)
      .send({
        clientInstanceId: "rollup-device",
        responses: [
          {
            questionId: f.question.id,
            seq: 1,
            selectedChoiceIds: [f.question.choices[0].id],
          },
        ],
      })
      .expect(201)

    async function rollups(query: { testId?: string; limit?: number }) {
      const response = await request(http)
        .get("/api/admin/results/rollups")
        .query(query)
        .set("Authorization", `Bearer ${f.token}`)
        .expect(200)

      return response.body as AdminResultRollups
    }
    const all = await rollups({ testId: f.testId, limit: 100 })
    const totals = {
      attemptCount: 1,
      score: 1,
      maxScore: 21,
      answeredCount: 1,
      correctCount: 1,
    }
    const { rows: questions } = await f.pool.query<{
      id: string
      label: string
      section_id: string
    }>(
      `SELECT q.id, q.question_key AS label, g.test_section_id AS section_id
         FROM question q JOIN question_group g ON g.id = q.question_group_id
        WHERE q.test_version_id = $1 ORDER BY q.question_key`,
      [f.versionId],
    )
    expect(questions).toHaveLength(21)
    expect(all).toEqual({
      tests: [{ id: f.testId, label: slug, ...totals }],
      versions: [{ id: f.versionId, label: `${doc.title} (v1)`, ...totals }],
      sections: [
        {
          id: questions[0].section_id,
          label: doc.sections[0].title,
          ...totals,
        },
      ],
      questions: questions.map(({ id, label }) => {
        const answered = Number(id === f.question.id)

        return {
          id,
          label,
          attemptCount: 1,
          score: answered,
          maxScore: 1,
          answeredCount: answered,
          correctCount: answered,
        }
      }),
    })
    expect(await rollups({ testId: f.testId })).toEqual({
      ...all,
      questions: all.questions.slice(0, 20),
    })
    expect(await rollups({ testId: f.testId, limit: 1 })).toEqual({
      ...all,
      questions: all.questions.slice(0, 1),
    })
    expect(
      await rollups({ testId: "00000000-0000-0000-0000-000000000000" }),
    ).toEqual({ tests: [], versions: [], sections: [], questions: [] })
    expect((await rollups({})).tests).toContainEqual(all.tests[0])
    for (const privateValue of [
      student.studentId,
      attemptId,
      ...f.question.choices.map(({ id }) => id),
    ]) {
      expect(JSON.stringify(all)).not.toContain(privateValue)
    }
  })

  it.each([
    { testId: "invalid" },
    { limit: "0" },
    { limit: "101" },
    { limit: "1.5" },
    { limit: ["1", "2"] },
    { cursor: "unused" },
    { learnerId: "00000000-0000-0000-0000-000000000000" },
  ])("rejects invalid or unsupported rollup parameters %o", async (query) => {
    const a = ready()
    const token = await a.mint({ sub: SUB, email: EMAIL, isAdmin: true })
    const response = await request(a.http.getHttpServer() as App)
      .get("/api/admin/results/rollups")
      .query(query)
      .set("Authorization", `Bearer ${token}`)
      .expect(400)
    expect(response.body).toMatchObject({ type: "invalid_query" })
  })

  it("loads another learner's attempt only for admins and audits each successful view", async () => {
    const a = ready()
    const { pool, student, fixture } = await completedAttempt(
      `${SUB}-detail-owner`,
    )
    const adminSubject = `${SUB}-detail-viewer`
    const admin = await a.mint({
      sub: adminSubject,
      email: EMAIL,
      isAdmin: true,
    })
    const path = `/api/admin/results/attempts/${fixture.attemptId}`
    await request(a.http.getHttpServer() as App)
      .get(path)
      .set("Authorization", `Bearer ${student.token}`)
      .expect(403)
    const before = await pool.query(
      "SELECT id FROM admin_audit_log WHERE resource_id = $1",
      [fixture.attemptId],
    )
    expect(before.rows).toEqual([])
    const response = await request(a.http.getHttpServer() as App)
      .get(path)
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)
      .expect("Cache-Control", "no-store")
    const detail = response.body as AdminAttemptDetail
    expect(detail).toMatchObject({
      attemptId: fixture.attemptId,
      learnerId: student.studentId,
      score: 1,
      maxScore: 2,
      answers: [
        {
          questionId: fixture.appliedQuestionId,
          response: { selectedChoiceIds: [fixture.choiceIds[0]] },
          score: 1,
          maxScore: 1,
        },
        {
          questionId: fixture.staleQuestionId,
          response: { selectedChoiceIds: [] },
          score: 0,
          maxScore: 1,
        },
      ],
    })
    const audit = await pool.query(
      "SELECT admin_subject, action, resource_type, resource_id, metadata FROM admin_audit_log WHERE resource_id = $1",
      [fixture.attemptId],
    )
    expect(audit.rows).toEqual([
      {
        admin_subject: adminSubject,
        action: "attempt_detail_viewed",
        resource_type: "attempt",
        resource_id: fixture.attemptId,
        metadata: {},
      },
    ])
    await request(a.http.getHttpServer() as App)
      .get(path)
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)
      .expect("Cache-Control", "no-store")
    const repeated = await pool.query(
      "SELECT id FROM admin_audit_log WHERE resource_id = $1",
      [fixture.attemptId],
    )
    expect(repeated.rows).toHaveLength(2)
  })

  it("withholds attempt answers when the audit append fails", async () => {
    const a = ready()
    const { pool, fixture } = await completedAttempt(
      `${SUB}-audit-failure-owner`,
    )
    const admin = await a.mint({
      sub: `${SUB}-audit-failure-viewer`,
      email: EMAIL,
      isAdmin: true,
    })
    failAuditWrites = true

    try {
      const response = await request(a.http.getHttpServer() as App)
        .get(`/api/admin/results/attempts/${fixture.attemptId}`)
        .set("Authorization", `Bearer ${admin}`)
        .expect(500)
      expect(response.body).not.toHaveProperty("answers")
      expect(JSON.stringify(response.body)).not.toContain(fixture.choiceIds[0])
    } finally {
      failAuditWrites = false
    }

    const audit = await pool.query(
      "SELECT id FROM admin_audit_log WHERE resource_id = $1",
      [fixture.attemptId],
    )
    expect(audit.rows).toEqual([])
  })

  it("returns attempt_not_found without auditing missing, malformed, or running attempts", async () => {
    const a = ready()
    const pool = a.get<PgPool>(REQUEST_POOL)
    const student = await provisionStudent(a, `${SUB}-running-owner`)
    const running = await seedWriteFixture(pool, student.studentId)
    const adminSubject = `${SUB}-missing-viewer`
    const token = await a.mint({
      sub: adminSubject,
      email: EMAIL,
      isAdmin: true,
    })
    for (const id of [
      "00000000-0000-0000-0000-000000000000",
      "not-a-uuid",
      running.attemptId,
    ]) {
      // eslint-disable-next-line no-await-in-loop -- Supertest binds/closes this shared server per request.
      const response = await request(a.http.getHttpServer() as App)
        .get(`/api/admin/results/attempts/${id}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(404)
      expect(response.body).toMatchObject({
        type: "attempt_not_found",
        status: 404,
      })
    }
    const audit = await pool.query(
      "SELECT id FROM admin_audit_log WHERE admin_subject = $1",
      [adminSubject],
    )
    expect(audit.rows).toEqual([])
  })

  it("searches and pages learner profiles and activity without exposing roles", async () => {
    const a = ready()
    const { pool, student } = await completedAttempt(`${SUB}-learners-a`)
    const other = await provisionStudent(a, `${SUB}-learners-b`)
    await pool.query(
      "UPDATE student SET display_name = $2, email = $3 WHERE id = $1",
      [student.studentId, "Admin learner Alpha", "admin-learner-a@example.com"],
    )
    await pool.query(
      "UPDATE student SET display_name = $2, email = $3 WHERE id = $1",
      [other.studentId, "Admin learner Beta", "admin-learner-b@example.com"],
    )
    const admin = await a.mint({
      sub: `${SUB}-learner-reader`,
      email: EMAIL,
      isAdmin: true,
    })
    const firstResponse = await request(a.http.getHttpServer() as App)
      .get("/api/admin/learners")
      .query({ search: " admin learner ", limit: 1 })
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)
    const first = firstResponse.body as AdminLearnerPage
    expect(first.items).toEqual([
      {
        id: student.studentId,
        displayName: "Admin learner Alpha",
        email: "admin-learner-a@example.com",
        attemptCount: 1,
        lastAttemptAt: first.items[0].lastAttemptAt,
      },
    ])
    expect(first.items[0].lastAttemptAt).toEqual(expect.any(String))
    expect(first.nextCursor).toEqual(expect.any(String))
    const nextResponse = await request(a.http.getHttpServer() as App)
      .get("/api/admin/learners")
      .query({ search: "admin learner", limit: 1, cursor: first.nextCursor })
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)
    expect(nextResponse.body).toEqual({
      items: [
        {
          id: other.studentId,
          displayName: "Admin learner Beta",
          email: "admin-learner-b@example.com",
          attemptCount: 0,
          lastAttemptAt: null,
        },
      ],
      nextCursor: null,
    })
    const byEmail = await request(a.http.getHttpServer() as App)
      .get("/api/admin/learners")
      .query({ search: "admin-learner-b@" })
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)
    expect(
      (byEmail.body as AdminLearnerPage).items.map((item) => item.id),
    ).toEqual([other.studentId])
  })

  it.each(["/api/admin/results", "/api/admin/learners"])(
    "GET %s validates pagination, cursors, and allowed filters",
    async (path) => {
      const a = ready()
      const admin = await a.mint({
        sub: `${SUB}-activity-validation`,
        email: EMAIL,
        isAdmin: true,
      })
      const invalid = path.endsWith("results")
        ? [
            { limit: "0" },
            { limit: "101" },
            { limit: "1.5" },
            { cursor: "invalid" },
            { learnerId: "bad" },
            { testId: "bad" },
            { search: "unused" },
          ]
        : [
            { limit: "0" },
            { limit: "101" },
            { limit: "1.5" },
            { cursor: "invalid" },
            { search: "x".repeat(201) },
            { role: "admin" },
          ]
      for (const query of invalid) {
        // eslint-disable-next-line no-await-in-loop -- Supertest binds/closes this shared server per request.
        await request(a.http.getHttpServer() as App)
          .get(path)
          .query(query)
          .set("Authorization", `Bearer ${admin}`)
          .expect(400)
      }
    },
  )

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
