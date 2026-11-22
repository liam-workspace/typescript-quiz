import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "../src/i18n.js"
import { networkStore } from "../src/lib/network.js"
import { toastStore } from "../src/lib/toast.js"
import {
  OfflineDownloadError,
  offlineStore,
  type DownloadProgress,
  type OfflineTestRecord,
} from "../src/lib/offline/offline-store.js"
import {
  resetOfflineLibraryForTests,
  useOfflineLibrary,
} from "../src/lib/offline/use-offline.js"

const record: OfflineTestRecord = {
  slug: "practice-3",
  testVersionId: "v1",
  version: 1,
  title: "Practice Test 3",
  level: "primary-step-1",
  totalBytes: 6,
  savedAt: "2026-11-22T12:00:00.000Z",
}

interface Options {
  readonly onProgress: (p: DownloadProgress) => void
  readonly signal: AbortSignal
}

/** A download that never finishes by itself and rejects when aborted. */
function pendingUntilAborted(signal: AbortSignal): Promise<OfflineTestRecord> {
  const { promise, reject } = Promise.withResolvers<OfflineTestRecord>()

  signal.addEventListener("abort", () => {
    reject(new DOMException("aborted", "AbortError"))
  })

  return promise
}

describe("useOfflineLibrary", () => {
  beforeEach(() => {
    networkStore.setOnlineForTests(true)
    vi.spyOn(offlineStore, "snapshot").mockReturnValue([])
    vi.spyOn(offlineStore, "subscribe").mockReturnValue(() => undefined)
  })

  afterEach(() => {
    cleanup()
    resetOfflineLibraryForTests()
    vi.restoreAllMocks()
    networkStore.setOnlineForTests(true)
    toastStore.resetForTests()
  })

  it("reports byte-weighted progress while saving and toasts when done", async () => {
    let finish: (value: OfflineTestRecord) => void = () => undefined
    let report: Options["onProgress"] = () => undefined

    vi.spyOn(offlineStore, "download").mockImplementation(
      (_slug, opts: Options) => {
        report = opts.onProgress

        return new Promise((resolve) => {
          finish = resolve
        })
      },
    )
    const show = vi.spyOn(toastStore, "show")
    const { result } = renderHook(() => useOfflineLibrary())

    act(() => {
      result.current.save("practice-3", "Practice Test 3")
    })
    expect(result.current.progressPercent.get("practice-3")).toBe(0)

    act(() => {
      report({ doneBytes: 3, totalBytes: 6 })
    })
    expect(result.current.progressPercent.get("practice-3")).toBe(50)

    await act(async () => {
      finish(record)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        "Practice Test 3 is saved for offline use.",
        "cloud",
      )
    })
    expect(result.current.progressPercent.has("practice-3")).toBe(false)
  })

  it("owns progress per slug: a remounted card still shows it and a second save starts nothing", async () => {
    let report: Options["onProgress"] = () => undefined
    const download = vi
      .spyOn(offlineStore, "download")
      .mockImplementation((_slug, opts: Options) => {
        report = opts.onProgress

        return pendingUntilAborted(opts.signal)
      })
    const first = renderHook(() => useOfflineLibrary())

    act(() => {
      first.result.current.save("practice-3", "Practice Test 3")
      report({ doneBytes: 2, totalBytes: 4 })
    })
    first.unmount()

    const second = renderHook(() => useOfflineLibrary())

    expect(second.result.current.progressPercent.get("practice-3")).toBe(50)

    act(() => {
      second.result.current.save("practice-3", "Practice Test 3")
    })
    expect(download).toHaveBeenCalledOnce()

    // Settle the pending save so the module-level state is clean for later tests.
    act(() => {
      networkStore.setOnlineForTests(false)
    })
    await waitFor(() => {
      expect(second.result.current.progressPercent.size).toBe(0)
    })
  })

  it("aborts in-flight saves when the network drops and says the save is paused", async () => {
    const seen: AbortSignal[] = []

    vi.spyOn(offlineStore, "download").mockImplementation(
      (_slug, { signal }: Options) => {
        seen.push(signal)

        return pendingUntilAborted(signal)
      },
    )
    const show = vi.spyOn(toastStore, "show")
    const { result } = renderHook(() => useOfflineLibrary())

    act(() => {
      result.current.save("practice-3", "Practice Test 3")
    })
    act(() => {
      networkStore.setOnlineForTests(false)
    })

    await waitFor(() => {
      expect(seen[0]?.aborted).toBe(true)
    })
    await waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        "Save paused — you're offline. Try again when connected.",
        "wifioff",
      )
    })
    expect(result.current.progressPercent.has("practice-3")).toBe(false)
  })

  it.each([
    ["http", "Couldn't save Practice Test 3. Try again.", "alert"],
    ["unsupported", "Couldn't save Practice Test 3. Try again.", "alert"],
    [
      "network",
      "Save paused — you're offline. Try again when connected.",
      "wifioff",
    ],
  ] as const)(
    "a %s failure toasts and clears the saving state",
    async (reason, message, icon) => {
      vi.spyOn(offlineStore, "download").mockRejectedValue(
        new OfflineDownloadError("nope", reason),
      )
      const show = vi.spyOn(toastStore, "show")
      const { result } = renderHook(() => useOfflineLibrary())

      act(() => {
        result.current.save("practice-3", "Practice Test 3")
      })

      await waitFor(() => {
        expect(show).toHaveBeenCalledWith(message, icon)
      })
      await waitFor(() => {
        expect(result.current.progressPercent.has("practice-3")).toBe(false)
      })
    },
  )

  it("an abort that is not ours (purge) reads as a failure, not a pause", async () => {
    vi.spyOn(offlineStore, "download").mockRejectedValue(
      new DOMException("cleared", "AbortError"),
    )
    const show = vi.spyOn(toastStore, "show")
    const { result } = renderHook(() => useOfflineLibrary())

    act(() => {
      result.current.save("practice-3", "Practice Test 3")
    })

    await waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        "Couldn't save Practice Test 3. Try again.",
        "alert",
      )
    })
  })

  it("does not start a save while offline", () => {
    networkStore.setOnlineForTests(false)
    const download = vi.spyOn(offlineStore, "download")
    const { result } = renderHook(() => useOfflineLibrary())

    act(() => {
      result.current.save("practice-3", "Practice Test 3")
    })

    expect(download).not.toHaveBeenCalled()
  })

  it("remove calls the store and toasts", async () => {
    const remove = vi.spyOn(offlineStore, "remove").mockResolvedValue()
    const show = vi.spyOn(toastStore, "show")
    const { result } = renderHook(() => useOfflineLibrary())

    act(() => {
      result.current.remove("practice-3", "Practice Test 3")
    })

    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith("practice-3")
    })
    await waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        "Practice Test 3 removed from this phone.",
        "trash",
      )
    })
  })

  it("a failed remove toasts instead of throwing", async () => {
    vi.spyOn(offlineStore, "remove").mockRejectedValue(new Error("idb"))
    const show = vi.spyOn(toastStore, "show")
    const { result } = renderHook(() => useOfflineLibrary())

    act(() => {
      result.current.remove("practice-3", "Practice Test 3")
    })

    await waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        "Couldn't remove Practice Test 3. Try again.",
        "alert",
      )
    })
  })

  it("exposes saved records by slug", () => {
    vi.spyOn(offlineStore, "snapshot").mockReturnValue([record])
    const { result } = renderHook(() => useOfflineLibrary())

    expect(result.current.saved.get("practice-3")).toBe(record)
  })
})
