import { isRedirect } from "@tanstack/react-router"
import { beforeEach, describe, expect, it } from "vitest"
import {
  CALLBACK_PATH,
  SIGN_IN_PATH,
  requireAuth,
} from "../src/lib/auth-guard.js"
import { readAndClearPostSignInRedirect } from "../src/lib/postSignInRedirect.js"
import { tokenStore } from "../src/lib/tokenStore.js"

function thrownBy(fn: () => void): unknown {
  try {
    fn()

    return undefined
  } catch (error) {
    return error
  }
}

describe("requireAuth", () => {
  beforeEach(() => {
    tokenStore.clear()
    sessionStorage.clear()
  })

  it("does not redirect the sign-in page itself, even with no session", () => {
    expect(() => requireAuth(SIGN_IN_PATH)).not.toThrow()
  })

  it("does not redirect the callback page itself, even with no session", () => {
    expect(() => requireAuth(CALLBACK_PATH)).not.toThrow()
  })

  it("does not redirect a protected route when a session exists", () => {
    tokenStore.set("access_token", "token-abc")

    expect(() => requireAuth("/")).not.toThrow()
  })

  it("redirects a protected route with no session to sign-in", () => {
    const thrown = thrownBy(() => requireAuth("/attempts/attempt-1/run"))

    expect(isRedirect(thrown)).toBe(true)

    if (isRedirect(thrown)) {
      expect(thrown.options).toMatchObject({ href: SIGN_IN_PATH })
    }
  })

  it("remembers the intended destination so it can be returned to after sign-in", () => {
    thrownBy(() => requireAuth("/attempts/attempt-1/run"))

    expect(readAndClearPostSignInRedirect()).toBe("/attempts/attempt-1/run")
  })
})
