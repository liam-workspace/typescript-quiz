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
})
