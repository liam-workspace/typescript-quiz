import "fake-indexeddb/auto"
import { describe, expect, it, vi } from "vitest"
import { JournalStore } from "../src/lib/attempt/journal-store.js"
import { getAttemptRuntime } from "../src/lib/attempt/runtime.js"

describe("getAttemptRuntime", () => {
  it("a transient IndexedDB open failure does not disable offline attempts for the rest of the tab", async () => {
    const open = vi
      .spyOn(JournalStore, "open")
      .mockRejectedValueOnce(new DOMException("busy", "UnknownError"))

    await expect(getAttemptRuntime()).rejects.toThrow("busy")

    const runtime = await getAttemptRuntime()

    expect(runtime.journal).toBeInstanceOf(JournalStore)
    expect(await getAttemptRuntime()).toBe(runtime)
    expect(open).toHaveBeenCalledTimes(2)
  })
})
