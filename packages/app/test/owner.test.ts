import { afterEach, describe, expect, it } from "vitest"
import { currentSubject } from "../src/lib/attempt/owner.js"
import { tokenStore } from "../src/lib/tokenStore.js"

const b64url = (value: object): string =>
  btoa(JSON.stringify(value))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/[=]+$/u, "")

afterEach(() => {
  tokenStore.clear()
})

describe("currentSubject", () => {
  it("reads sub from the stored access token's payload", () => {
    tokenStore.set("access_token", `h.${b64url({ sub: "sub-9", n: "ü?>" })}.s`)

    expect(currentSubject()).toBe("sub-9")
  })

  it("is null with no token, a malformed token, or no sub", () => {
    expect(currentSubject()).toBeNull()

    tokenStore.set("access_token", "not-a-jwt")
    expect(currentSubject()).toBeNull()

    tokenStore.set("access_token", "h.%%%.s")
    expect(currentSubject()).toBeNull()

    tokenStore.set("access_token", `h.${b64url({ iss: "x" })}.s`)
    expect(currentSubject()).toBeNull()
  })
})
