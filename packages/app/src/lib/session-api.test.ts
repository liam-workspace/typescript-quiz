import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "./api-client.js"
import { getCurrentStudent } from "./session-api.js"

describe("session-api", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("getCurrentStudent calls GET /api/me and returns the complete profile", async () => {
    const student = {
      id: "student-1",
      displayName: "Tom Nguyen",
      email: "tom@example.com",
      level: "primary-step-1" as const,
      isAdmin: false,
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(student), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await getCurrentStudent()

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/me")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()
    expect(result).toEqual(student)
  })

  // The caller decides what a failure means, and for /me the answer is "we
  // do not know the child's name yet" -- its 404 is the ordinary state of a
  // fresh install ("call POST /session first"), not an exception. This pins
  // that getCurrentStudent REJECTS rather than resolving undefined, so the
  // choice to swallow it stays visible at the call site instead of being
  // buried here where no reader would look for it.
  it("rejects on a 404 rather than resolving undefined, leaving the choice to the caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: "no_profile",
            title: "No profile for this sub.",
            status: 404,
          }),
          {
            headers: { "content-type": "application/problem+json" },
            status: 404,
          },
        ),
      ),
    )

    await expect(getCurrentStudent()).rejects.toBeInstanceOf(ApiError)
  })
})
