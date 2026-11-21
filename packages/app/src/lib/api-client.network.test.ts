import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apiFetch, resetApiClientForTests } from "./api-client.js"
import { resetAuthClientForTests } from "./auth.js"
import { networkStore, resetNetworkStoreForTests } from "./network.js"
import { tokenStore } from "./tokenStore.js"

describe("apiFetch connectivity reporting", () => {
  beforeEach(() => {
    tokenStore.clear()
    resetAuthClientForTests()
    resetApiClientForTests()
    resetNetworkStoreForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetNetworkStoreForTests()
  })

  it("marks the network down when the request itself rejects, and rethrows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")),
    )

    await expect(apiFetch("/tests")).rejects.toBeInstanceOf(TypeError)
    expect(networkStore.getSnapshot().online).toBe(false)
  })

  it("marks the network up again on any response, including an error status", async () => {
    networkStore.reportFetchFailure()
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ type: "x", title: "x", status: 409 }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    await expect(apiFetch("/tests")).rejects.toMatchObject({
      problem: { status: 409 },
    })
    expect(networkStore.getSnapshot().online).toBe(true)
  })

  it("does not blame the network for a non-network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("something else")),
    )

    await expect(apiFetch("/tests")).rejects.toThrow("something else")
    expect(networkStore.getSnapshot().online).toBe(true)
  })
})
