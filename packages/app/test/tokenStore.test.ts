import { beforeEach, describe, expect, it } from "vitest"
import { tokenStore } from "../src/lib/tokenStore.js"

describe("tokenStore", () => {
  beforeEach(() => {
    tokenStore.clear()
  })

  it("returns null for a key that was never saved", () => {
    expect(tokenStore.get("access_token")).toBeNull()
  })

  it("returns what was saved", () => {
    tokenStore.set("access_token", "token-abc")

    expect(tokenStore.get("access_token")).toBe("token-abc")
  })

  it("clears on sign-out", () => {
    tokenStore.set("access_token", "token-abc")
    tokenStore.set("refresh_token", "refresh-abc")

    tokenStore.clear()

    expect(tokenStore.get("access_token")).toBeNull()
    expect(tokenStore.get("refresh_token")).toBeNull()
  })

  it("removes a single key without touching the others", () => {
    tokenStore.set("access_token", "token-abc")
    tokenStore.set("refresh_token", "refresh-abc")

    tokenStore.remove("access_token")

    expect(tokenStore.get("access_token")).toBeNull()
    expect(tokenStore.get("refresh_token")).toBe("refresh-abc")
  })

  // Persisted, not in-memory-only: a save must survive a reload. There is
  // no `tokenStore` instance to recreate (it is a singleton), so this
  // reads the real underlying localStorage key directly to prove the value
  // lives in storage itself, not in a variable this module happens to
  // hold onto for the lifetime of the page.
  it("survives a reload -- persisted to localStorage, not held in memory", () => {
    tokenStore.set("refresh_token", "refresh-abc")

    expect(localStorage.getItem("pp.auth.refresh_token")).toBe("refresh-abc")
  })
})
