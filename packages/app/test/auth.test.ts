import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  completeSignIn,
  currentAccessToken,
  getAuthClient,
  hasSession,
  resetAuthClientForTests,
  signOut,
  startSignIn,
} from "../src/lib/auth.js"
import { requestUrl } from "../src/test/requestUrl.js"
import { tokenStore } from "../src/lib/tokenStore.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("auth", () => {
  beforeEach(() => {
    tokenStore.clear()
    resetAuthClientForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    tokenStore.clear()
    resetAuthClientForTests()
  })

  describe("startSignIn", () => {
    it("builds the authorize URL from configuration (never a hardcoded host), with PKCE and offline_access, and navigates there", async () => {
      const assign = vi.fn()
      vi.stubGlobal("location", { assign, origin: "http://localhost:3000" })

      await startSignIn()

      expect(assign).toHaveBeenCalledOnce()

      const url = new URL(assign.mock.calls[0]?.[0] as string)

      expect(url.origin + url.pathname).toBe(
        `${import.meta.env.VITE_AUTH_ISSUER}/auth`,
      )
      expect(url.searchParams.get("client_id")).toBe(
        import.meta.env.VITE_AUTH_CLIENT_ID,
      )
      expect(url.searchParams.get("redirect_uri")).toBe(
        import.meta.env.VITE_AUTH_REDIRECT_URI,
      )
      expect(url.searchParams.get("response_type")).toBe("code")
      expect(url.searchParams.get("code_challenge_method")).toBe("S256")
      expect(url.searchParams.get("code_challenge")).toBeTruthy()
      expect(url.searchParams.get("scope")?.split(" ")).toEqual(
        expect.arrayContaining([
          "openid",
          "email",
          "profile",
          "offline_access",
        ]),
      )
    })

    it("persists the PKCE verifier for the callback", async () => {
      vi.stubGlobal("location", {
        assign: vi.fn(),
        origin: "http://localhost:3000",
      })

      await startSignIn()

      expect(tokenStore.get("pkce_verifier")).toBeTruthy()
    })
  })

  // Flat, not a nested `describe("completeSignIn", ...)`: both tests below
  // mock `fetch` with a handler that needs its own name (for
  // require-await/no-base-to-string reasons), and a fourth level of
  // nesting (describe > describe > it > handler) trips oxlint's
  // max-nested-callbacks. Named "completeSignIn: ..." instead.

  it("completeSignIn: exchanges the code, stores the token, then calls POST /api/session exactly once -- in that order", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:3000" })
    // Seed the verifier the way startSignIn would have.
    tokenStore.set("pkce_verifier", "verifier-abc")

    const calls: string[] = []
    const handleFetch: typeof fetch = (input, init) => {
      const url = requestUrl(input)

      calls.push(url)

      if (url.includes("/token")) {
        return Promise.resolve(
          jsonResponse({
            access_token: "access-1",
            id_token: "id-1",
            refresh_token: "refresh-1",
          }),
        )
      }

      if (url === "/api/session") {
        // The token must already be attached and stored by the time this
        // fires.
        const headers = new Headers(init?.headers)

        expect(headers.get("authorization")).toBe("Bearer access-1")
        expect(tokenStore.get("access_token")).toBe("access-1")

        return Promise.resolve(
          jsonResponse(
            {
              id: "student-1",
              displayName: "Tom",
              email: "tom@example.com",
              level: "primary-step-1",
              isAdmin: false,
              created: true,
            },
            201,
          ),
        )
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }

    vi.stubGlobal("fetch", vi.fn<typeof fetch>(handleFetch))

    const result = await completeSignIn("auth-code-1")

    expect(result).toMatchObject({ id: "student-1", created: true })

    // Order: the token exchange happened before the session call, and the
    // session call happened exactly once. Written without `.findIndex`/
    // `.filter` callbacks -- at this nesting depth those would be a
    // second flagged level of their own.
    let tokenCallIndex = -1

    for (const [index, url] of calls.entries()) {
      if (url.includes("/token")) {
        tokenCallIndex = index

        break
      }
    }

    const sessionCalls = calls.filter(isSessionUrl)

    expect(tokenCallIndex).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf("/api/session")).toBeGreaterThan(tokenCallIndex)
    expect(sessionCalls).toHaveLength(1)
  })

  it("completeSignIn: surfaces a 403 (email not on the allowlist) as an ApiError rather than swallowing it", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:3000" })
    tokenStore.set("pkce_verifier", "verifier-abc")

    const handleFetch: typeof fetch = (input) => {
      const url = requestUrl(input)

      if (url.includes("/token")) {
        return Promise.resolve(
          jsonResponse({
            access_token: "access-1",
            id_token: "id-1",
            refresh_token: "refresh-1",
          }),
        )
      }

      return Promise.resolve(
        jsonResponse(
          {
            type: "email_not_allowed",
            title: "This account cannot use this app.",
            status: 403,
          },
          403,
        ),
      )
    }

    vi.stubGlobal("fetch", vi.fn<typeof fetch>(handleFetch))

    await expect(completeSignIn("auth-code-1")).rejects.toMatchObject({
      problem: { status: 403 },
    })
  })

  describe("hasSession / currentAccessToken", () => {
    it("is false/null with nothing stored", () => {
      expect(hasSession()).toBe(false)
      expect(currentAccessToken()).toBeNull()
    })

    it("is true once a token is stored, without needing the client constructed first", () => {
      tokenStore.set("access_token", "token-abc")
      tokenStore.set("id_token", "id-abc")

      expect(hasSession()).toBe(true)
      expect(currentAccessToken()).toBe("token-abc")
    })
  })

  describe("signOut", () => {
    it("clears the token store", () => {
      tokenStore.set("access_token", "token-abc")
      tokenStore.set("id_token", "id-abc")
      tokenStore.set("refresh_token", "refresh-abc")

      signOut()

      expect(hasSession()).toBe(false)
      expect(tokenStore.get("refresh_token")).toBeNull()
    })

    it("clears a session even if the client was never constructed", () => {
      tokenStore.set("access_token", "token-abc")
      tokenStore.set("id_token", "id-abc")

      signOut()

      expect(hasSession()).toBe(false)
    })
  })

  it("hydrates a persisted session into the client on first use, without a network call", () => {
    tokenStore.set("access_token", "token-abc")
    tokenStore.set("id_token", "id-abc")
    tokenStore.set("refresh_token", "refresh-abc")

    const authClient = getAuthClient()

    expect(authClient.getTokens()).toEqual({
      accessToken: "token-abc",
      idToken: "id-abc",
      refreshToken: "refresh-abc",
    })
  })
})

function isSessionUrl(url: string): boolean {
  return url === "/api/session"
}
