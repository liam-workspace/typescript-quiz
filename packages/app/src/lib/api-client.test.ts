import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resetAuthClientForTests } from "./auth.js"
import { ApiError, apiFetch, resetApiClientForTests } from "./api-client.js"
import { requestUrl } from "../test/requestUrl.js"
import { tokenStore } from "./tokenStore.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("apiFetch", () => {
  beforeEach(() => {
    tokenStore.clear()
    resetAuthClientForTests()
    resetApiClientForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    tokenStore.clear()
    resetAuthClientForTests()
    resetApiClientForTests()
  })

  it("attaches the dev bearer token when one is configured and there is no real session", async () => {
    vi.stubEnv("DEV", true)
    vi.stubEnv("VITE_DEV_AUTH", "true")
    vi.stubEnv("VITE_DEV_AUTH_TOKEN", "dev-token")
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "student-1" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await apiFetch<{ id: string }>("/me")

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/me")
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization"),
    ).toBe("Bearer dev-token")
  })

  // Task 1 Step 3: a dev token is a FALLBACK, never a shadow over a real
  // signed-in session.
  it("uses the real session's bearer token instead of the dev token when both are present", async () => {
    vi.stubEnv("DEV", true)
    vi.stubEnv("VITE_DEV_AUTH", "true")
    vi.stubEnv("VITE_DEV_AUTH_TOKEN", "dev-token")
    tokenStore.set("access_token", "real-access-token")
    tokenStore.set("id_token", "real-id-token")
    tokenStore.set("refresh_token", "real-refresh-token")

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ id: "student-1" }))

    vi.stubGlobal("fetch", fetchMock)

    await apiFetch<{ id: string }>("/me")

    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization"),
    ).toBe("Bearer real-access-token")
  })

  it("throws ApiError with the parsed problem+json body on a non-2xx response", async () => {
    const problem = {
      type: "attempt_expired",
      title: "Attempt expired",
      status: 410,
      detail: "The deadline has passed.",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(problem), {
          headers: { "content-type": "application/problem+json" },
          status: 410,
        }),
      ),
    )

    const thrown: unknown = await apiFetch("/attempts/attempt-1").catch(
      (error: unknown) => error,
    )

    expect(thrown).toBeInstanceOf(ApiError)
    expect(thrown).toMatchObject({ message: problem.type, problem })
  })

  it("returns undefined for a 204 with no body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 204 })),
    )

    const result = await apiFetch<undefined>("/session", { method: "POST" })

    expect(result).toBeUndefined()
  })

  it("defaults request bodies to JSON", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ created: true }), { status: 201 }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await apiFetch("/session", { body: "{}", method: "POST" })

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/session")
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe("{}")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST")
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("content-type"),
    ).toBe("application/json")
  })

  it("preserves caller Headers values", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ created: true }), { status: 201 }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await apiFetch("/session", {
      body: "{}",
      headers: new Headers({
        "content-type": "application/merge-patch+json",
        "x-request-id": "request-1",
      }),
      method: "POST",
    })

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get("content-type")).toBe("application/merge-patch+json")
    expect(headers.get("x-request-id")).toBe("request-1")
  })

  // Task 2 Step 5: offline_access exists so a mid-test 401 can be
  // recovered from silently, without ejecting a child from a timed exam.
  describe("refresh on a 401 (a real session exists)", () => {
    beforeEach(() => {
      tokenStore.set("access_token", "expired-access-token")
      tokenStore.set("id_token", "id-token")
      tokenStore.set("refresh_token", "refresh-token")
      vi.stubGlobal("location", {
        assign: vi.fn(),
        pathname: "/attempts/attempt-1/run",
        search: "",
      })
    })

    it("refreshes the access token and retries, WITHOUT redirecting to sign-in", async () => {
      let apiCalls = 0
      const handleFetch: typeof fetch = (input, init) => {
        const url = requestUrl(input)

        if (url.includes("/token")) {
          return Promise.resolve(
            jsonResponse({
              access_token: "fresh-access-token",
              id_token: "id-token",
              refresh_token: "refresh-token",
            }),
          )
        }

        apiCalls += 1

        if (apiCalls === 1) {
          // The pre-refresh call, carrying the now-expired token.
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer expired-access-token",
          )

          return Promise.resolve(
            jsonResponse(
              { type: "invalid_token", title: "Expired", status: 401 },
              401,
            ),
          )
        }

        // The retried call, carrying the refreshed token.
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer fresh-access-token",
        )

        return Promise.resolve(jsonResponse({ id: "student-1" }))
      }
      const fetchMock = vi.fn<typeof fetch>(handleFetch)

      vi.stubGlobal("fetch", fetchMock)
      const location = globalThis.location as unknown as { assign: () => void }

      const result = await apiFetch<{ id: string }>("/me")

      expect(result).toEqual({ id: "student-1" })
      expect(apiCalls).toBe(2)
      expect(location.assign).not.toHaveBeenCalled()
      expect(tokenStore.get("access_token")).toBe("fresh-access-token")
    })

    it("falls back to sign-in cleanly when the refresh itself fails", async () => {
      const handleFetch: typeof fetch = (input) => {
        const url = requestUrl(input)

        if (url.includes("/token")) {
          return Promise.resolve(jsonResponse({ error: "invalid_grant" }, 400))
        }

        return Promise.resolve(
          jsonResponse(
            { type: "invalid_token", title: "Expired", status: 401 },
            401,
          ),
        )
      }
      const fetchMock = vi.fn<typeof fetch>(handleFetch)

      vi.stubGlobal("fetch", fetchMock)
      const location = globalThis.location as unknown as {
        assign: ReturnType<typeof vi.fn>
      }

      await expect(apiFetch<{ id: string }>("/me")).rejects.toBeInstanceOf(
        ApiError,
      )

      expect(location.assign).toHaveBeenCalledWith("/sign-in")
      // The dead session must not linger client-side once we have
      // bounced the child back to sign-in.
      expect(tokenStore.get("access_token")).toBeNull()
      expect(tokenStore.get("refresh_token")).toBeNull()
    })
  })

  it("redirects to sign-in on a 401 with no session at all, rather than rendering a dead screen", async () => {
    vi.stubGlobal("location", {
      assign: vi.fn(),
      pathname: "/",
      search: "",
    })
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse(
            { type: "invalid_token", title: "Missing token", status: 401 },
            401,
          ),
        ),
    )

    await expect(apiFetch("/me")).rejects.toBeInstanceOf(ApiError)

    const location = globalThis.location as unknown as {
      assign: ReturnType<typeof vi.fn>
    }

    expect(location.assign).toHaveBeenCalledWith("/sign-in")
  })
})
