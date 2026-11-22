import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { OfflineBundle } from "../src/lib/api-types.js"
import {
  createOfflineStore,
  findStimulusMedia,
  OfflineDownloadError,
  type OfflineCache,
  type OfflineStoreDeps,
} from "../src/lib/offline/offline-store.js"
import { purgeClientCaches } from "../src/lib/pwa/purge.js"
import { makeBundle } from "./helpers/bundle-fixture.js"

class FakeCache implements OfflineCache {
  readonly entries = new Map<string, Response>()

  put(key: string, response: Response): Promise<void> {
    this.entries.set(key, response)

    return Promise.resolve()
  }

  match(key: string): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(key)?.clone())
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.entries.delete(key))
  }
}

function twoChunkResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.enqueue(new Uint8Array([4, 5, 6]))
        controller.close()
      },
    }),
  )
}

let dbCounter = 0

function build(
  bundle: OfflineBundle,
  overrides: Partial<OfflineStoreDeps> = {},
): { store: ReturnType<typeof createOfflineStore>; cache: FakeCache } {
  const cache = new FakeCache()

  dbCounter += 1

  const store = createOfflineStore({
    dbName: `pp-offline-test-${dbCounter}`,
    cacheName: "pp-offline-media-test",
    fetchBundle: () => Promise.resolve(bundle),
    fetchMedia: () => Promise.resolve(twoChunkResponse()),
    cacheStorage: { open: () => Promise.resolve(cache) },
    now: () => new Date("2026-11-22T12:00:00.000Z"),
    ...overrides,
  })

  return { store, cache }
}

const NEVER_ABORTED = new AbortController().signal
const opts = { signal: NEVER_ABORTED, onProgress: () => undefined }

describe("offlineStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("downloads media with byte-weighted progress, then records the bundle", async () => {
    const { store, cache } = build(makeBundle())
    const seen: number[] = []

    const record = await store.download("practice-3", {
      signal: NEVER_ABORTED,
      onProgress: (p) => seen.push(p.doneBytes / p.totalBytes),
    })

    expect(seen).toEqual([0.5, 1])
    expect(record).toMatchObject({
      slug: "practice-3",
      testVersionId: "ver-1",
      totalBytes: 6,
    })
    expect(await store.has("practice-3")).toBe(true)
    expect((await store.getBundle("practice-3"))?.title).toBe("Practice Test 3")
    expect(cache.entries.size).toBe(1)
    expect((await store.getMediaBlob("l1.mp3"))?.size).toBe(6)
    expect(await store.getMediaBlob("missing.mp3")).toBeNull()
  })

  it("leaves nothing behind when aborted mid-download", async () => {
    const { store, cache } = build(makeBundle())
    const controller = new AbortController()

    await expect(
      store.download("practice-3", {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" })

    expect(await store.has("practice-3")).toBe(false)
    expect(cache.entries.size).toBe(0)
  })

  it("removes already-cached files when a later file is aborted", async () => {
    const bundle = makeBundle({
      media: [
        ...makeBundle().media,
        { ...makeBundle().media[0], key: "l2.mp3", stimulusId: "st-r" },
      ],
      totalBytes: 12,
    })
    const { store, cache } = build(bundle)
    const controller = new AbortController()

    await expect(
      store.download("practice-3", {
        signal: controller.signal,
        // Fires on the 3rd chunk, i.e. while the second file streams.
        onProgress: (p) => p.doneBytes === 9 && controller.abort(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" })

    expect(cache.entries.size).toBe(0)
    expect(await store.has("practice-3")).toBe(false)
  })

  it("cleans up and throws OfflineDownloadError on a failed media response", async () => {
    const { store, cache } = build(makeBundle(), {
      fetchMedia: () => Promise.resolve(new Response("nope", { status: 403 })),
    })

    const failure = store.download("practice-3", opts)

    await expect(failure).rejects.toBeInstanceOf(OfflineDownloadError)
    await expect(failure).rejects.toThrow("media l1.mp3 returned 403")
    expect(await store.has("practice-3")).toBe(false)
    expect(cache.entries.size).toBe(0)
  })

  it("surfaces a lost connection as a typed 'network' error", async () => {
    const { store, cache } = build(makeBundle(), {
      fetchMedia: () => Promise.reject(new TypeError("Failed to fetch")),
    })

    await expect(store.download("practice-3", opts)).rejects.toMatchObject({
      name: "OfflineDownloadError",
      reason: "network",
    })
    expect(await store.has("practice-3")).toBe(false)
    expect(cache.entries.size).toBe(0)
  })

  it("downloads a duplicated manifest key once and never reports over 100%", async () => {
    const [item] = makeBundle().media
    const bundle = makeBundle({ media: [item, { ...item }], totalBytes: 12 })
    const fetchMedia = vi.fn(() => Promise.resolve(twoChunkResponse()))
    const { store } = build(bundle, { fetchMedia })
    const ratios: number[] = []

    const record = await store.download("practice-3", {
      signal: NEVER_ABORTED,
      onProgress: (p) => ratios.push(p.doneBytes / p.totalBytes),
    })

    expect(fetchMedia).toHaveBeenCalledTimes(1)
    expect(Math.max(...ratios)).toBe(1)
    expect(record.totalBytes).toBe(6)
  })

  it("remove drops unshared media but keeps media another saved test still uses", async () => {
    const shared = makeBundle()
    const other = makeBundle({
      slug: "practice-4",
      testVersionId: "ver-2",
      title: "Practice Test 4",
    })
    const { store, cache } = build(shared, {
      fetchBundle: (slug) =>
        Promise.resolve(slug === "practice-3" ? shared : other),
    })

    await store.download("practice-3", opts)
    await store.download("practice-4", opts)
    await store.remove("practice-3")

    expect(await store.has("practice-3")).toBe(false)
    expect(cache.entries.size).toBe(1)

    await store.remove("practice-4")

    expect(cache.entries.size).toBe(0)
  })

  it("keeps snapshot() reference-stable until something changes, and notifies subscribers", async () => {
    const { store } = build(makeBundle())
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    await store.whenReady()

    const before = store.snapshot()

    expect(store.snapshot()).toBe(before)

    await store.download("practice-3", opts)

    expect(listener).toHaveBeenCalled()
    expect(store.snapshot()).not.toBe(before)
    expect(store.snapshot().map((r) => r.slug)).toEqual(["practice-3"])
    unsubscribe()
  })

  it("removeAll empties the store and the media cache", async () => {
    const { store, cache } = build(makeBundle())

    await store.download("practice-3", opts)
    await store.removeAll()

    expect(await store.list()).toEqual([])
    expect(store.snapshot()).toEqual([])
    expect(cache.entries.size).toBe(0)
  })

  it("survives a sign-out purge while open and does not resurrect data", async () => {
    const { store, cache } = build(makeBundle(), { dbName: "pp-offline" })

    await store.download("practice-3", opts)
    await purgeClientCaches()
    await store.whenReady()

    expect(store.snapshot()).toEqual([])
    expect(await store.getBundle("practice-3")).toBeNull()
    expect(await store.list()).toEqual([])
    // The real purge clears Cache Storage by name; this fake is not purged.
    expect(cache.entries.size).toBe(1)

    await expect(store.download("practice-3", opts)).resolves.toMatchObject({
      slug: "practice-3",
    })
  })
})

describe("findStimulusMedia", () => {
  it("matches a capped stimulus to its media entry", () => {
    const bundle = makeBundle()

    expect(findStimulusMedia(bundle, "st-l")?.key).toBe("l1.mp3")
    expect(findStimulusMedia(bundle, "st-r")).toBeUndefined()
  })
})
