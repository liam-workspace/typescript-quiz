import { afterEach, describe, expect, it, vi } from "vitest"
import { getDevBearerToken } from "./dev-auth.js"

describe("getDevBearerToken", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns null when VITE_DEV_AUTH is not enabled", () => {
    vi.stubEnv("VITE_DEV_AUTH", "false")
    vi.stubEnv("VITE_DEV_AUTH_TOKEN", "dev-token")

    expect(getDevBearerToken()).toBeNull()
  })

  it("returns the configured token when VITE_DEV_AUTH is enabled in dev", () => {
    vi.stubEnv("DEV", true)
    vi.stubEnv("VITE_DEV_AUTH", "true")
    vi.stubEnv("VITE_DEV_AUTH_TOKEN", "dev-token")

    expect(getDevBearerToken()).toBe("dev-token")
  })

  it("returns null when nothing is configured", () => {
    vi.stubEnv("VITE_DEV_AUTH", "")
    vi.stubEnv("VITE_DEV_AUTH_TOKEN", "")

    expect(getDevBearerToken()).toBeNull()
  })

  // The gate this whole function exists for: VITE_DEV_AUTH is a dev
  // shortcut, never a bypass, and it must be IMPOSSIBLE to enable in a
  // deployed build -- not merely undocumented. `import.meta.env.DEV` is
  // `false` in every `vite build` (production) output, so a real build's
  // minifier removes this branch as dead code; this test pins the runtime
  // behavior that makes that true, regardless of what the other env vars
  // say.
  it("returns null outside of dev mode even if VITE_DEV_AUTH and the token are both set", () => {
    vi.stubEnv("DEV", false)
    vi.stubEnv("VITE_DEV_AUTH", "true")
    vi.stubEnv("VITE_DEV_AUTH_TOKEN", "dev-token")

    expect(getDevBearerToken()).toBeNull()
  })
})
