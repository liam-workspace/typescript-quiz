import { describe, expect, it, vi } from "vitest"
import { pendingCountStore } from "./pending-count.js"

describe("pendingCountStore", () => {
  it("holds the number of answers waiting to be sent and notifies on change only", () => {
    const listener = vi.fn()
    const unsubscribe = pendingCountStore.subscribe(listener)

    pendingCountStore.set(0)
    expect(listener).not.toHaveBeenCalled()

    pendingCountStore.set(3)
    expect(pendingCountStore.getSnapshot()).toBe(3)
    expect(listener).toHaveBeenCalledTimes(1)

    pendingCountStore.set(-2)
    expect(pendingCountStore.getSnapshot()).toBe(0)

    unsubscribe()
    pendingCountStore.set(5)
    expect(listener).toHaveBeenCalledTimes(2)
    pendingCountStore.set(0)
  })
})
