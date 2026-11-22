import type { PgPool } from "@liam-workspace/node-postgres"
import {
  testDocumentSchema,
  type AdminQuestionPage,
  type TestDocument,
} from "@pp/common"
import { insertGenerationCandidate, reviewCandidate } from "@pp/db/admin"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { createTestApp, type TestApp } from "./helpers/app.js"

const SUB = "google-oauth2|attempts-runner-test"
const EMAIL = "tom@example.com"

/**
 * Two sections, one question each, one known-correct choice per question --
 * enough for the runner envelope's section/question-count checks, and
 * enough to know exactly which choice `isCorrect` would leak if it ever did.
 */
function twoSectionDoc(slug: string): TestDocument {
  return testDocumentSchema.parse({
    title: "Runner Envelope E2E Test",
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
        instructions: [],
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

/** No content -- fine for the 410 path, which finalizes before any read of it. */
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

interface RunnerEnvelopeSectionBody {
  id: string
  status: string
  completedAt: string | null
  expiresAt: string | null
  groups: Array<{
    questions: Array<{ id: string; choices: Array<{ id: string }> }>
  }>
}

interface RunnerEnvelopeBody {
  id: string
  status: string
  expiresAt: string | null
  serverTime: string
  questionCount: number
  answeredCount: number
  unansweredOrdinals: number[]
  currentSectionId: string | null
  currentQuestionId: string | null
  sections: RunnerEnvelopeSectionBody[]
  responses: unknown[]
  offlineJournalCursor: number
}

describe("GET /attempts/:id", () => {
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

  it("returns the runner envelope for the owning student", async () => {
    const a = ready()
    const adminToken = await a.mint({
      sub: `${SUB}-admin-owner`,
      email: EMAIL,
      isAdmin: true,
    })
    const slug = `runner-owner-${randomUUID()}`
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

    const { token } = await provision(a, `${SUB}-owner`)
    const attemptId = await startAttempt(a, token, slug)

    const res = await request(a.http.getHttpServer() as App)
      .get(`/api/attempts/${attemptId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    const body = res.body as RunnerEnvelopeBody

    expect(body.id).toBe(attemptId)
    expect(body.status).toBe("in_progress")
    expect(body.expiresAt).toBeNull()
    expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false)
    expect(body.questionCount).toBe(2)
    expect(body.answeredCount).toBe(0)
    expect(body.unansweredOrdinals).toEqual([1, 2])
    expect(body.currentSectionId).toBeNull()
    expect(body.currentQuestionId).toBeNull()
    expect(body.responses).toEqual([])
    expect(body.offlineJournalCursor).toBe(0)
    expect(body.sections).toHaveLength(2)

    for (const section of body.sections) {
      expect(section.status).toBe("pending")
      expect(section.completedAt).toBeNull()
      expect(section.expiresAt).toBeNull()
    }
  })

  it.each([
    ["after_test", 601, "unchanged"],
    ["hidden", 602, "unchanged"],
    [null, 603, "unchanged"],
    ["after_test", 604, "answer edit"],
    ["after_test", 605, "prompt edit"],
    ["after_test", 606, "choice edit"],
  ] as const)(
    "serves published math display blocks and gates the worked solution for policy %s (value %i, %s)",
    async (policy, value, edit) => {
      const a = ready()
      const pool = a.get<PgPool>(REQUEST_POOL)
      const server = a.http.getHttpServer() as App
      const admin = `Bearer ${await a.mint({ sub: SUB, email: EMAIL, isAdmin: true })}`
      const slug = `runner-math-${randomUUID()}`
      const answer = (n: number) => ({
        kind: "integer" as const,
        numerator: n,
        denominator: 1,
      })
      const block = (tex: string) => ({
        kind: "math" as const,
        tex,
        display: false,
      })
      const promptBlocks = [
        { kind: "text" as const, value: "Calculate" },
        block(`${value}/1`),
      ]
      const solutionBlocks = [
        { kind: "text" as const, value: "Approved worked explanation" },
        block(`${value}/1=${value}`),
      ]
      const choices = [value + 1, value].map((n) => ({
        label: String(n),
        labelBlocks: [block(String(n))],
        isCorrect: n === value,
      }))
      const {
        rows: [source],
      } = await pool.query<{ id: string }>(
        `INSERT INTO ai_generation_request (parameters, provider, model, prompt_template_version, seed, status)
         VALUES ($1, 'private-provider', 'private-model', 'v1', $2, 'completed') RETURNING id`,
        [{ curriculumBrief: policy ? { solutionPolicy: policy } : {} }, slug],
      )
      const candidate = await insertGenerationCandidate(pool, {
        requestId: source.id,
        canonicalSpec: {
          family: "ratio",
          seed: slug,
          variables: {},
          constraints: { min: 0, max: 1000, nonNegative: true },
          expression: {
            kind: "divide",
            left: { kind: "integer", value },
            right: { kind: "integer", value: 1 },
          },
          answer: answer(value),
          choices: choices.map((c) => ({
            answer: answer(Number(c.label)),
            isCorrect: c.isCorrect,
          })),
        },
        presentation: { promptBlocks, choices, solutionBlocks },
        rawResponse: { providerOnly: "private-raw-response" },
      })
      await reviewCandidate(pool, {
        candidateId: candidate.id,
        reviewerSubject: SUB,
        decision: "approved",
      })
      const imported = await request(server)
        .post("/api/admin/math/imports")
        .set("Authorization", admin)
        .send({
          slug,
          title: "Math test",
          durationSeconds: 120,
          candidateIds: [candidate.id],
        })
        .expect(201)
      const { testId, versionId } = imported.body as {
        testId: string
        versionId: string
      }
      const draft = await request(server)
        .get("/api/admin/questions")
        .query({ testId })
        .set("Authorization", admin)
        .expect(200)
      const [draftQuestion] = (draft.body as AdminQuestionPage).items
      const prompt =
        edit === "prompt edit" ? "Double this quantity" : draftQuestion.prompt
      const editedChoices = draftQuestion.choices.map((c, index) => ({
        ...c,
        label: edit === "choice edit" && index === 0 ? "Two more" : c.label,
        isCorrect: edit === "answer edit" ? !c.isCorrect : c.isCorrect,
      }))
      await request(server)
        .patch(`/api/admin/drafts/${versionId}/questions/${draftQuestion.id}`)
        .set("Authorization", admin)
        .send({ prompt, choices: editedChoices })
        .expect(200)
      const { token } = await provision(a, slug)
      const learner = `Bearer ${token}`
      await request(server)
        .post("/api/attempts")
        .set("Authorization", learner)
        .send({ slug })
        .expect(409)
      // The import freezes the policy, even before publication.
      await pool.query(
        "UPDATE ai_generation_request SET parameters=$1 WHERE id=$2",
        [
          {
            curriculumBrief: {
              solutionPolicy: policy === "after_test" ? "hidden" : "after_test",
            },
          },
          source.id,
        ],
      )
      await request(server)
        .post(`/api/admin/tests/${testId}/publish`)
        .set("Authorization", admin)
        .expect(200)
      const id = await startAttempt(a, token, slug)
      const path = `/api/attempts/${id}`
      const runner = await request(server)
        .get(path)
        .set("Authorization", learner)
        .expect(200)
      const expectedPrompt =
        edit === "prompt edit"
          ? [{ kind: "text", value: prompt }, promptBlocks[1]]
          : promptBlocks
      const safeChoices = editedChoices.map((c, index) => ({
        label: c.label,
        labelBlocks:
          c.label === choices[index].label
            ? choices[index].labelBlocks
            : [...choices[index].labelBlocks, { kind: "text", value: c.label }],
      }))
      expect(runner.body).toMatchObject({
        sections: [
          {
            type: "math",
            groups: [
              {
                questions: [
                  { promptBlocks: expectedPrompt, choices: safeChoices },
                ],
              },
            ],
          },
        ],
      })
      const forbidden =
        /"(?:answer_?spec|is_?correct|canonical_?spec|expression|provenance|raw_?response|validator_?reports|solution_?blocks|content_?hash|source_?candidate_?id)"/iu
      expect(runner.text).not.toMatch(forbidden)
      expect(runner.text).not.toContain("Approved worked explanation")
      const runningReview = await request(server)
        .get(`${path}/review`)
        .set("Authorization", learner)
        .expect(409)
      expect(runningReview.body).toMatchObject({ type: "still_running" })
      const [section] = (runner.body as RunnerEnvelopeBody).sections
      await request(server)
        .post(`${path}/sections/${section.id}/enter`)
        .set("Authorization", learner)
        .expect(200)
      const [question] = section.groups[0].questions
      await request(server)
        .post(`${path}/submit`)
        .set("Authorization", learner)
        .send({
          clientInstanceId: "math-runner",
          responses: [
            {
              questionId: question.id,
              seq: 1,
              selectedChoiceIds: [question.choices[1].id],
            },
          ],
        })
        .expect(201)
      const review = await request(server)
        .get(`${path}/review`)
        .set("Authorization", learner)
        .expect(200)
      expect(review.body).toMatchObject({
        items: [
          {
            sectionType: "math",
            promptBlocks: expectedPrompt,
            choices: editedChoices.map((c, i) => ({
              ...safeChoices[i],
              isCorrect: c.isCorrect,
            })),
          },
        ],
      })

      if (policy === "after_test" && edit === "unchanged") {
        expect(review.body).toMatchObject({ items: [{ solutionBlocks }] })
      } else {
        expect(review.text).not.toContain('"solutionBlocks"')
        expect(review.text).not.toContain("Approved worked explanation")
      }

      for (const privateValue of [
        source.id,
        candidate.id,
        candidate.contentHash,
        "private-provider",
        "private-raw-response",
        '"expression"',
        '"answer"',
      ]) {
        expect(runner.text).not.toContain(privateValue)
        expect(review.text).not.toContain(privateValue)
      }
    },
  )

  it("403s for another student's attempt", async () => {
    const a = ready()
    const adminToken = await a.mint({
      sub: `${SUB}-admin-forbidden`,
      email: EMAIL,
      isAdmin: true,
    })
    const slug = `runner-forbidden-${randomUUID()}`
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

    const owner = await provision(a, `${SUB}-forbidden-owner`)
    const attemptId = await startAttempt(a, owner.token, slug)

    const stranger = await provision(a, `${SUB}-forbidden-stranger`)

    await request(a.http.getHttpServer() as App)
      .get(`/api/attempts/${attemptId}`)
      .set("Authorization", `Bearer ${stranger.token}`)
      .expect(403)

    // Bracketed the other way in "returns the runner envelope for the
    // owning student" above: the SAME attempt id, the owner's token, 200.
    await request(a.http.getHttpServer() as App)
      .get(`/api/attempts/${attemptId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200)
  })

  it("401s with no token", async () => {
    const a = ready()

    await request(a.http.getHttpServer() as App)
      .get(`/api/attempts/${randomUUID()}`)
      .expect(401)
  })

  it("410s and finalizes a past-deadline attempt, returning the finalized shape", async () => {
    const fixedNow = new Date("2027-01-15T12:00:00.000Z")
    const startedAt = new Date(fixedNow.getTime() - 60 * 60 * 1000)
    const expiresAt = new Date(fixedNow.getTime() - 10 * 60 * 1000)
    const fixedApp = await createTestApp({ now: fixedNow })

    try {
      const { token, studentId } = await provision(fixedApp, `${SUB}-expired`)
      const pool = fixedApp.get<PgPool>(REQUEST_POOL)
      const slug = `runner-expired-${randomUUID()}`
      const { versionId } = await insertPublishedTest(pool, {
        slug,
        title: "Runner Expired Test",
      })
      const attemptId = await insertStaleAttempt(pool, {
        studentId,
        versionId,
        startedAt,
        expiresAt,
      })

      const res = await request(fixedApp.http.getHttpServer() as App)
        .get(`/api/attempts/${attemptId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(410)

      const problem = res.body as {
        type: string
        status: number
        attempt: {
          id: string
          status: string
          submittedAt: string
          resultUrl: string
        }
      }

      expect(problem.type).toBe("attempt_expired")
      expect(problem.status).toBe(410)
      expect(problem.attempt.id).toBe(attemptId)
      expect(problem.attempt.status).toBe("expired")
      expect(problem.attempt.submittedAt).toBe(expiresAt.toISOString())
      expect(problem.attempt.resultUrl).toBe(`/attempts/${attemptId}/result`)

      const { rows } = await pool.query<{ status: string }>(
        `SELECT status FROM attempt WHERE id = $1`,
        [attemptId],
      )

      expect(rows[0].status).toBe("expired")
    } finally {
      await fixedApp.close()
    }
  })

  it("never serializes isCorrect anywhere in the response body", async () => {
    const a = ready()
    const adminToken = await a.mint({
      sub: `${SUB}-admin-secret`,
      email: EMAIL,
      isAdmin: true,
    })
    const slug = `runner-secret-${randomUUID()}`
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

    const { token } = await provision(a, `${SUB}-secret`)
    const attemptId = await startAttempt(a, token, slug)

    const res = await request(a.http.getHttpServer() as App)
      .get(`/api/attempts/${attemptId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    const serialized = JSON.stringify(res.body)

    expect(serialized).not.toContain("isCorrect")
    expect(serialized).not.toContain("is_correct")
    // Positive control: the fixture's known-correct labels DO appear (as
    // plain choice text, with no correctness marker attached), so this test
    // is exercising real content rather than passing vacuously against an
    // empty envelope.
    expect(serialized).toContain("Read a book")
    expect(serialized).toContain("It began to rain")
  })
})
