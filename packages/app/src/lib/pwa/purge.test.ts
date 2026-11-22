import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  purgeClientCaches,
  purgeIfSubjectChanged,
  registerPurgeStep,
  resetPurgeStepsForTests,
} from "./purge.js"

function createDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)

    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => {
      reject(request.error ?? new Error("indexedDB open failed"))
    }
  })
}

async function dbNames(): Promise<string[]> {
  return (await indexedDB.databases()).map((db) => db.name ?? "")
}

describe("purgeClientCaches", () => {
  const deleted: string[] = []

  beforeEach(() => {
    deleted.length = 0
    resetPurgeStepsForTests()
    vi.stubGlobal("caches", {
      delete: vi.fn((name: string) => {
        deleted.push(name)

        return Promise.resolve(true)
      }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it("deletes the API cache and the offline media cache", async () => {
    await purgeClientCaches()

    expect(deleted.sort()).toEqual(["pp-api-v1", "pp-offline-media-v1"])
  })

  it("deletes the saved-test database but leaves the answer queue's database alone", async () => {
    await createDb("pp-offline")
    await createDb("pp-answer-queue-sentinel")

    await purgeClientCaches()

    expect(await dbNames()).toEqual(["pp-answer-queue-sentinel"])
  })

  it("runs registered steps and survives one that throws or rejects", async () => {
    const ran = vi.fn()

    registerPurgeStep(() => {
      throw new Error("sync boom")
    })
    registerPurgeStep(() => Promise.reject(new Error("async boom")))
    registerPurgeStep(() => {
      ran()

      return Promise.resolve()
    })

    await expect(purgeClientCaches()).resolves.toBeUndefined()
    expect(ran).toHaveBeenCalledTimes(1)
  })

  it("is idempotent and tolerates a browser with no Cache Storage", async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal("caches", undefined)

    await purgeClientCaches()
    await expect(purgeClientCaches()).resolves.toBeUndefined()
  })
})

describe("purge steps (registry)", () => {
  beforeEach(() => {
    resetPurgeStepsForTests()
    vi.stubGlobal("caches", { delete: vi.fn(() => Promise.resolve(true)) })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("starts every step SYNCHRONOUSLY, in registration order, before purgeClientCaches returns", () => {
    const order: string[] = []

    registerPurgeStep(() => {
      order.push("first")
    })
    registerPurgeStep(() => {
      order.push("second")

      return Promise.resolve()
    })

    void purgeClientCaches()

    // Nothing awaited: a step that needs the bearer token must be able to
    // read it in its first lines, because signOut() clears it right after.
    expect(order).toEqual(["first", "second"])
  })

  it("stops calling a step once it is unregistered", async () => {
    const step = vi.fn()
    const off = registerPurgeStep(step)

    off()
    await purgeClientCaches()

    expect(step).not.toHaveBeenCalled()
  })

  it("collapses a re-entrant purge into the one already running", async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const step = vi.fn(() => gate)

    registerPurgeStep(step)

    const first = purgeClientCaches()
    const second = purgeClientCaches()

    release()
    await Promise.all([first, second])

    expect(step).toHaveBeenCalledTimes(1)

    // Once settled, the next purge runs the steps again.
    await purgeClientCaches()
    expect(step).toHaveBeenCalledTimes(2)
  })
})

describe("purgeIfSubjectChanged", () => {
  const cacheDelete = vi.fn(() => Promise.resolve(true))

  beforeEach(() => {
    resetPurgeStepsForTests()
    cacheDelete.mockClear()
    vi.stubGlobal("caches", { delete: cacheDelete })
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("does not purge on the very first sign-in, but remembers who signed in", async () => {
    await purgeIfSubjectChanged("student-a")

    expect(cacheDelete).not.toHaveBeenCalled()
    expect(localStorage.getItem("pp.last-student")).toBe("student-a")
  })

  it("does not purge when the same student signs in again", async () => {
    await purgeIfSubjectChanged("student-a")
    await purgeIfSubjectChanged("student-a")

    expect(cacheDelete).not.toHaveBeenCalled()
  })

  it("purges when a different student signs in on the same browser", async () => {
    await purgeIfSubjectChanged("student-a")
    await purgeIfSubjectChanged("student-b")

    expect(cacheDelete).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem("pp.last-student")).toBe("student-b")
  })

  it("does nothing when storage throws (private mode) and never rejects", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })

    await expect(purgeIfSubjectChanged("student-a")).resolves.toBeUndefined()
    vi.restoreAllMocks()
  })
})
