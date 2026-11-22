import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { toastStore } from "./toast.js"

describe("toastStore", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    toastStore.show("reset")
    vi.advanceTimersByTime(4000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("shows a message with the default check icon and clears it after 3800 ms", () => {
    const listener = vi.fn()

    toastStore.subscribe(listener)
    toastStore.show("Saved")

    expect(toastStore.getSnapshot()).toMatchObject({
      message: "Saved",
      icon: "check",
    })

    vi.advanceTimersByTime(3799)
    expect(toastStore.getSnapshot()).not.toBeNull()

    vi.advanceTimersByTime(1)
    expect(toastStore.getSnapshot()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("a newer toast replaces the older one and restarts the timer", () => {
    toastStore.show("first", "cloud")
    vi.advanceTimersByTime(3000)
    toastStore.show("second", "bell")

    expect(toastStore.getSnapshot()).toMatchObject({
      message: "second",
      icon: "bell",
    })

    vi.advanceTimersByTime(3000)
    expect(toastStore.getSnapshot()?.message).toBe("second")

    vi.advanceTimersByTime(800)
    expect(toastStore.getSnapshot()).toBeNull()
  })

  it("gives each toast a new id so an identical message re-announces", () => {
    toastStore.show("same")
    const first = toastStore.getSnapshot()?.id

    toastStore.show("same")

    expect(toastStore.getSnapshot()?.id).not.toBe(first)
  })
})
