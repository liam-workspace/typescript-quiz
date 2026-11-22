import "fake-indexeddb/auto"
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { JournalStore } from "../src/lib/attempt/journal-store.js"
import { useLocalAttemptIds } from "../src/lib/attempt/use-local-attempts.js"
import { tokenStore } from "../src/lib/tokenStore.js"
import { makeLocalState } from "./helpers/local-state-fixture.js"

const runtime = vi.hoisted(() => ({
  get: vi.fn<() => Promise<unknown>>(),
}))

vi.mock("../src/lib/attempt/runtime.js", () => ({
  getAttemptRuntime: () => runtime.get(),
}))

const tokenFor = (sub: string): string =>
  `h.${btoa(JSON.stringify({ sub })).replace(/[=]+$/u, "")}.s`

afterEach(() => {
  tokenStore.clear()
})

describe("useLocalAttemptIds", () => {
  it("lists only the signed-in student's unfinished attempts on a shared phone", async () => {
    const journal = await JournalStore.open("pp-use-local-1")

    await journal.putAttempt(makeLocalState({ attemptId: "mine" }))
    await journal.putAttempt(
      makeLocalState({ attemptId: "sibling", ownerSub: "sub-2" }),
    )
    await journal.putAttempt(
      makeLocalState({ attemptId: "unowned", ownerSub: null }),
    )
    await journal.putAttempt(
      makeLocalState({
        attemptId: "mine-over",
        finalized: { status: "expired", submittedAt: "x" },
      }),
    )
    runtime.get.mockResolvedValue({ journal })
    tokenStore.set("access_token", tokenFor("sub-1"))

    const { result } = renderHook(() => useLocalAttemptIds())

    await waitFor(() => expect([...result.current]).toEqual(["mine"]))
  })

  it("is empty when the offline runtime cannot open", async () => {
    runtime.get.mockRejectedValue(new Error("blocked"))

    const { result } = renderHook(() => useLocalAttemptIds())

    await Promise.resolve()

    expect(result.current.size).toBe(0)
  })
})
