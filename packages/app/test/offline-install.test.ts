import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AttemptGateway } from "../src/lib/attempt/attempt-gateway.js"
import {
  attemptGateway,
  setAttemptGateway,
} from "../src/lib/attempt/gateway-selector.js"
import { installOfflineAttempts } from "../src/lib/attempt/install.js"
import { JournalStore } from "../src/lib/attempt/journal-store.js"
import { RemoteAttemptGateway } from "../src/lib/attempt/remote-gateway.js"
import {
  purgeClientCaches,
  resetPurgeStepsForTests,
} from "../src/lib/pwa/purge.js"
import { makeLocalState } from "./helpers/local-state-fixture.js"

const runtime = vi.hoisted(() => ({
  get: vi.fn<() => Promise<unknown>>(),
}))

vi.mock("../src/lib/attempt/runtime.js", () => ({
  getAttemptRuntime: () => runtime.get(),
}))

const syncAll = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  resetPurgeStepsForTests()
  syncAll.mockClear()
})

afterEach(() => {
  setAttemptGateway(new RemoteAttemptGateway())
})

describe("installOfflineAttempts", () => {
  it("routes the app-wide gateway through the hybrid and syncs at start and on `online`", async () => {
    const hybrid = {
      isLocalOnly: vi.fn().mockResolvedValue(true),
    } as unknown as AttemptGateway
    const journal = await JournalStore.open("pp-install-1")

    runtime.get.mockResolvedValue({
      gateway: hybrid,
      journal,
      sync: { syncAll },
    })
    installOfflineAttempts()

    expect(await attemptGateway.isLocalOnly("att-1")).toBe(true)
    await vi.waitFor(() => expect(syncAll).toHaveBeenCalledTimes(1))

    window.dispatchEvent(new Event("online"))

    expect(syncAll).toHaveBeenCalledTimes(2)
  })

  it("keeps working remote-only when IndexedDB cannot be opened", async () => {
    runtime.get.mockRejectedValue(new Error("blocked"))
    installOfflineAttempts()

    expect(await attemptGateway.isLocalOnly("att-1")).toBe(false)
  })

  it("sign-out purge deletes synced attempts and keeps unsynced work (spec D8)", async () => {
    const journal = await JournalStore.open("pp-install-2")

    await journal.putAttempt(
      makeLocalState({ attemptId: "synced", serverKnown: true }),
    )
    await journal.putAttempt(
      makeLocalState({ attemptId: "unsynced", serverKnown: true }),
    )
    await journal.append("unsynced", {
      type: "position",
      clientAt: "2026-11-22T11:00:00.000Z",
      payload: { sectionId: "sec-l", questionId: "q-l1" },
    })
    await journal.putAttempt(
      makeLocalState({ attemptId: "offline-start", serverKnown: false }),
    )
    runtime.get.mockResolvedValue({ gateway: {}, journal, sync: { syncAll } })
    installOfflineAttempts()

    await purgeClientCaches()

    expect(
      (await journal.listAttempts()).map((a) => a.attemptId).sort(),
    ).toEqual(["offline-start", "unsynced"])
  })
})
