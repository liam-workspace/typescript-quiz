import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  networkStore,
  resetNetworkStoreForTests,
  setRecoveryProbeForTests,
} from "./network.js"

describe("networkStore", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetNetworkStoreForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts online and notifies subscribers only when the value changes", () => {
    const listener = vi.fn()
    const unsubscribe = networkStore.subscribe(listener)

    networkStore.reportFetchSuccess()
    expect(listener).not.toHaveBeenCalled()

    networkStore.reportFetchFailure()
    expect(networkStore.getSnapshot().online).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)

    networkStore.reportFetchFailure()
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    networkStore.reportFetchSuccess()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("returns a referentially stable snapshot while nothing changed (useSyncExternalStore requirement)", () => {
    expect(networkStore.getSnapshot()).toBe(networkStore.getSnapshot())
  })

  it("goes offline on the browser offline event and recovers on the online event", () => {
    window.dispatchEvent(new Event("offline"))
    expect(networkStore.getSnapshot().online).toBe(false)

    window.dispatchEvent(new Event("online"))
    expect(networkStore.getSnapshot().online).toBe(true)
  })

  it("treats a hard fetch failure as offline even though navigator.onLine is still true, then probes until the server answers", async () => {
    const probe = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    setRecoveryProbeForTests(probe)
    networkStore.reportFetchFailure()
    expect(networkStore.getSnapshot().online).toBe(false)

    await vi.advanceTimersByTimeAsync(5000)
    expect(networkStore.getSnapshot().online).toBe(false)

    await vi.advanceTimersByTimeAsync(5000)
    expect(networkStore.getSnapshot().online).toBe(true)
    expect(probe).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(20000)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it("setOnlineForTests forces the snapshot", () => {
    networkStore.setOnlineForTests(false)
    expect(networkStore.getSnapshot().online).toBe(false)
    networkStore.setOnlineForTests(true)
    expect(networkStore.getSnapshot().online).toBe(true)
  })
})
