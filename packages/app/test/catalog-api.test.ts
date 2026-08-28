import { afterEach, describe, expect, it, vi } from "vitest"
import { listTests } from "../src/lib/catalog-api.js"

const page = {
  tests: [
    {
      id: "test-04",
      slug: "primary-practice-04",
      title: "TOEFL Primary — Practice Test 04",
      level: "primary-step-1" as const,
      durationSeconds: 3000,
      sections: [
        { type: "listening" as const, questionCount: 20 },
        { type: "reading" as const, questionCount: 20 },
      ],
      inProgressAttemptId: null,
      attemptCount: 1,
      bestAttempt: {
        attemptId: "attempt-04",
        submittedAt: "2026-08-21T10:15:00.000Z",
        pointsEarned: 36,
        pointsPossible: 40,
        percentage: 90,
      },
    },
  ],
  nextCursor: "cursor/2",
  summary: { attemptCount: 3, averagePct: 82.5, bestPct: 90 },
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

describe("catalog-api", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("listTests calls GET /api/tests without a query and returns the complete page", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(page))
    vi.stubGlobal("fetch", fetchMock)

    const result = await listTests()

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/tests")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()
    expect(result).toEqual(page)
  })

  it("listTests passes an encoded cursor without overriding GET", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ ...page, nextCursor: null }))
    vi.stubGlobal("fetch", fetchMock)

    await listTests("cursor/2")

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/tests?cursor=cursor%2F2")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()
  })
})
