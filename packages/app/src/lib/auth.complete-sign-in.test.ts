import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "./api-client.js"

const { handleCallback, clientSignOut, establishSession } = vi.hoisted(() => ({
  handleCallback: vi.fn(),
  clientSignOut: vi.fn(),
  establishSession: vi.fn(),
}))

vi.mock("@liam-workspace/auth-client", () => ({
  createAuthClient: () => ({
    handleCallback,
    signOut: clientSignOut,
    onTokenChange: vi.fn(),
    setTokens: vi.fn(),
  }),
}))

vi.mock("./session-api.js", () => ({ establishSession }))

const { purgeClientCaches, purgeIfSubjectChanged } = vi.hoisted(() => ({
  purgeClientCaches: vi.fn(() => Promise.resolve()),
  purgeIfSubjectChanged: vi.fn(() => Promise.resolve()),
}))

vi.mock("./pwa/purge.js", () => ({ purgeClientCaches, purgeIfSubjectChanged }))

describe("completeSignIn", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv("VITE_AUTH_ISSUER", "https://auth.example")
    vi.stubEnv("VITE_AUTH_CLIENT_ID", "quiz-web")
    vi.stubEnv("VITE_AUTH_REDIRECT_URI", "https://quiz.example/callback")
    handleCallback.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it("returns the session and keeps the tokens when the session call succeeds", async () => {
    establishSession.mockResolvedValue({ id: "student", created: false })
    const { completeSignIn } = await import("./auth.js")

    await expect(completeSignIn("code")).resolves.toEqual({
      id: "student",
      created: false,
    })
    expect(clientSignOut).not.toHaveBeenCalled()
  })

  it("clears the stored tokens when the session call is refused, then rethrows", async () => {
    const refusal = new ApiError({
      type: "role_not_granted",
      title: "no role",
      status: 403,
    })

    establishSession.mockRejectedValue(refusal)
    const { completeSignIn } = await import("./auth.js")

    await expect(completeSignIn("code")).rejects.toBe(refusal)
    // HandleCallback had already stored them: without this, a reload opens the
    // library with a token whose account has no student profile.
    expect(clientSignOut).toHaveBeenCalledTimes(1)
  })

  it("checks for a student change using the established session's id", async () => {
    establishSession.mockResolvedValue({ id: "student-b", created: false })
    const { completeSignIn } = await import("./auth.js")

    await completeSignIn("code")

    expect(purgeIfSubjectChanged).toHaveBeenCalledWith("student-b")
  })

  it("purges client caches on sign-out", async () => {
    const { signOut } = await import("./auth.js")

    signOut()

    expect(purgeClientCaches).toHaveBeenCalledTimes(1)
  })
})
