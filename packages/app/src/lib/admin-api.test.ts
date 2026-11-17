import type {
  AdminAttemptDetail,
  AdminQuestion,
  DraftQuestionPatch,
} from "@pp/common"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getAdminAttempt,
  getAdminOverview,
  getAdminTest,
  listAdminLearners,
  listAdminQuestions,
  listAdminResults,
  listAdminTests,
  patchDraftQuestion,
} from "./admin-api.js"
import { ApiError } from "./api-client.js"

function respondWith(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status,
    }),
  )
  vi.stubGlobal("fetch", fetchMock)

  return fetchMock
}

describe("admin-api", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("loads the overview through the shared API prefix", async () => {
    const overview = {
      tests: { total: 4, drafts: 1, published: 3 },
      attempts: { total: 10, inProgress: 2, completed: 8 },
      learners: { total: 5 },
    }
    const fetchMock = respondWith(overview)

    expect(await getAdminOverview()).toEqual(overview)
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/overview")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()
  })

  it.each([
    ["tests", listAdminTests],
    ["questions", listAdminQuestions],
    ["results", listAdminResults],
    ["learners", listAdminLearners],
  ] as const)("loads %s without an empty query suffix", async (path, list) => {
    const page = { items: [], nextCursor: null }
    const fetchMock = respondWith(page)

    expect(await list()).toEqual(page)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/admin/${path}`)
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()
  })

  it("encodes test filters and opaque pagination cursors", async () => {
    const fetchMock = respondWith({ items: [], nextCursor: "next" })

    await listAdminTests({
      status: "draft",
      search: "math & science/đề",
      limit: 25,
      cursor: "a+b/c==",
    })

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string, "http://local")
    expect(url.pathname).toBe("/api/admin/tests")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: "draft",
      search: "math & science/đề",
      limit: "25",
      cursor: "a+b/c==",
    })
  })

  it("encodes question filters and preserves server answer keys", async () => {
    const question: AdminQuestion = {
      id: "question-1",
      prompt: "Pick the prime",
      choices: [
        { id: "choice-1", label: "2", isCorrect: true },
        { id: "choice-2", label: "4", isCorrect: false },
      ],
    }
    const page = { items: [question], nextCursor: "opaque+/=" }
    const fetchMock = respondWith(page)

    expect(
      await listAdminQuestions({
        testId: "test/1",
        search: "prime & odd",
        limit: 10,
        cursor: null,
      }),
    ).toEqual(page)
    const url = new URL(fetchMock.mock.calls[0]?.[0] as string, "http://local")
    expect(url.pathname).toBe("/api/admin/questions")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      testId: "test/1",
      search: "prime & odd",
      limit: "10",
    })
  })

  it("encodes result test and learner filters", async () => {
    const fetchMock = respondWith({ items: [], nextCursor: null })

    await listAdminResults({
      testId: "test/1",
      learnerId: "learner+2",
      cursor: "opaque+/=",
      limit: 5,
    })

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string, "http://local")
    expect(url.pathname).toBe("/api/admin/results")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      testId: "test/1",
      learnerId: "learner+2",
      cursor: "opaque+/=",
      limit: "5",
    })
  })

  it("encodes learner search and pagination", async () => {
    const fetchMock = respondWith({ items: [], nextCursor: null })

    await listAdminLearners({ search: "An & Bình", cursor: "a+b/", limit: 15 })

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string, "http://local")
    expect(url.pathname).toBe("/api/admin/learners")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      search: "An & Bình",
      cursor: "a+b/",
      limit: "15",
    })
  })

  it("encodes test IDs as one path segment", async () => {
    const detail = {
      id: "test/1 ?",
      title: "Draft test",
      status: "draft",
      currentVersionId: "version-1",
      updatedAt: "2026-11-16T12:00:00.000Z",
      description: null,
      durationSeconds: 600,
      sections: [],
    }
    const fetchMock = respondWith(detail)

    expect(await getAdminTest("test/1 ?")).toEqual(detail)
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/tests/test%2F1%20%3F")
  })

  it("loads attempt detail from the results route without changing answers", async () => {
    const detail: AdminAttemptDetail = {
      attemptId: "attempt/1 ?",
      testId: "test-1",
      testTitle: "Practice",
      learnerId: "learner-1",
      learnerName: "An",
      score: 1,
      maxScore: 2,
      completedAt: "2026-11-16T12:00:00.000Z",
      answers: [
        {
          questionId: "question-1",
          response: { selectedChoiceIds: ["choice-2"] },
          score: 0,
          maxScore: 1,
        },
        { questionId: "question-2", response: null, score: 1, maxScore: 1 },
      ],
    }
    const fetchMock = respondWith(detail)

    expect(await getAdminAttempt("attempt/1 ?")).toEqual(detail)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/admin/results/attempts/attempt%2F1%20%3F",
    )
  })

  it("patches the selected draft version question with the exact editable payload", async () => {
    const patch: DraftQuestionPatch = {
      prompt: "Updated prompt",
      choices: [
        { id: "choice-1", label: "A", isCorrect: false },
        { id: "choice-2", label: "B", isCorrect: true },
      ],
    }
    const updated = { id: "question/2?", ...patch }
    const fetchMock = respondWith(updated)

    expect(
      await patchDraftQuestion("version/1+", "question/2?", patch),
    ).toEqual(updated)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/admin/drafts/version%2F1%2B/questions/question%2F2%3F",
    )
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PATCH")
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(patch))
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("content-type"),
    ).toBe("application/json")
  })

  it("propagates API problems without converting them to empty results", async () => {
    const problem = {
      type: "forbidden",
      title: "Administrator access required",
      status: 403,
    }
    respondWith(problem, 403)

    const error = await listAdminResults().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).problem).toEqual(problem)
  })

  it("propagates draft mutation conflicts from apiFetch", async () => {
    const problem = {
      type: "draft_not_editable",
      title: "Only drafts can be edited",
      status: 409,
    }
    respondWith(problem, 409)

    await expect(
      patchDraftQuestion("version-1", "question-1", { prompt: "Updated" }),
    ).rejects.toMatchObject({ problem })
  })
})
