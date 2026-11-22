import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { signOut, resetAuthClientForTests } from "../src/lib/auth.js"
import { tokenStore } from "../src/lib/tokenStore.js"

const order: string[] = []

vi.mock("../src/lib/pwa/purge.js", () => ({
  purgeClientCaches: vi.fn(() => {
    order.push(`purge(token=${String(tokenStore.get("access_token"))})`)

    return Promise.resolve()
  }),
  purgeIfSubjectChanged: vi.fn(() => Promise.resolve()),
  registerPurgeStep: vi.fn(() => () => undefined),
}))

describe("signOut", () => {
  beforeEach(() => {
    order.length = 0
    tokenStore.clear()
    resetAuthClientForTests()
  })

  afterEach(() => {
    tokenStore.clear()
    resetAuthClientForTests()
  })

  it("starts the purge (and its steps) BEFORE the tokens are cleared", () => {
    tokenStore.set("access_token", "bearer-xyz")
    tokenStore.set("id_token", "id-xyz")

    signOut()

    expect(order).toEqual(["purge(token=bearer-xyz)"])
    expect(tokenStore.get("access_token")).toBeNull()
  })

  it("does the same when the OIDC client was already constructed", async () => {
    tokenStore.set("access_token", "bearer-xyz")
    tokenStore.set("id_token", "id-xyz")
    const { getAuthClient } = await import("../src/lib/auth.js")
    getAuthClient()

    signOut()

    expect(order).toEqual(["purge(token=bearer-xyz)"])
    expect(tokenStore.get("access_token")).toBeNull()
  })
})
