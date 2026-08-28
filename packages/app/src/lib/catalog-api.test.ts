import { afterEach, describe, expect, it, vi } from "vitest"
import { getTest } from "./catalog-api.js"

describe("catalog-api", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("getTest calls GET /api/tests/:slug and returns the test brief", async () => {
    const brief = {
      id: "test-04",
      slug: "primary-practice-04",
      title: "Practice Test 04",
      durationSeconds: 3000,
      attemptCount: 0,
      inProgressAttemptId: null,
      sections: [],
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(brief), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await getTest("primary-practice-04")

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/tests/primary-practice-04")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()
    expect(result).toEqual(brief)
  })
})
