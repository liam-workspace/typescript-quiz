import type { OfflineBundle, OfflineMedia, StudentLevel } from "../api-types.js"
import { getOfflineBundle } from "./offline-api.js"

export interface OfflineTestRecord {
  readonly slug: string
  readonly testVersionId: string
  readonly version: number
  readonly title: string
  readonly level: StudentLevel
  readonly totalBytes: number
  readonly savedAt: string
}

export interface DownloadProgress {
  readonly doneBytes: number
  readonly totalBytes: number
}

/** The slice of the Cache Storage API this module needs, so tests can fake it. */
export interface OfflineCache {
  put(key: string, response: Response): Promise<void>
  match(key: string): Promise<Response | undefined>
  delete(key: string): Promise<boolean>
}

export interface OfflineStoreDeps {
  readonly dbName: string
  readonly cacheName: string
  readonly fetchBundle: (slug: string) => Promise<OfflineBundle>
  readonly fetchMedia: (url: string, signal: AbortSignal) => Promise<Response>
  readonly cacheStorage: { open(name: string): Promise<OfflineCache> }
  readonly now: () => Date
}

export interface OfflineStore {
  list(): Promise<OfflineTestRecord[]>
  /** Sync and reference-stable between changes (useSyncExternalStore). */
  snapshot(): readonly OfflineTestRecord[]
  /** Resolves once `snapshot()` reflects IndexedDB. */
  whenReady(): Promise<void>
  has(slug: string): Promise<boolean>
  getBundle(slug: string): Promise<OfflineBundle | null>
  getMediaBlob(key: string): Promise<Blob | null>
  download(
    slug: string,
    opts: { onProgress(p: DownloadProgress): void; signal: AbortSignal },
  ): Promise<OfflineTestRecord>
  remove(slug: string): Promise<void>
  removeAll(): Promise<void>
  subscribe(listener: () => void): () => void
}

/**
 * `http`: the server refused a file (expired signature, 403, 5xx).
 * `network`: the connection dropped mid-save ("Save paused" in the UI).
 */
export class OfflineDownloadError extends Error {
  readonly reason: "http" | "network"

  constructor(message: string, reason: "http" | "network") {
    super(message)
    this.name = "OfflineDownloadError"
    this.reason = reason
  }
}

/**
 * Capped stimuli carry no `mediaUrl` in the bundle's `groups`; this is how a
 * consumer finds the saved file for one.
 */
export function findStimulusMedia(
  bundle: OfflineBundle,
  stimulusId: string,
): OfflineMedia | undefined {
  return bundle.media.find((item) => item.stimulusId === stimulusId)
}

const TESTS_STORE = "tests"
// Cache Storage keys are Requests; a reserved .invalid origin can never
// collide with a real request the service worker might see.
const MEDIA_ORIGIN = "https://offline.invalid/media/"

interface StoredTest {
  readonly slug: string
  readonly record: OfflineTestRecord
  readonly bundle: OfflineBundle
}

const mediaKey = (key: string): string =>
  `${MEDIA_ORIGIN}${encodeURIComponent(key)}`

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError"

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"))
  })
}

function settle(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted"))
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB transaction failed"))
  })
}

/** One entry per `key`: a shared asset is downloaded and counted once. */
function uniqueMedia(bundle: OfflineBundle): OfflineMedia[] {
  return [...new Map(bundle.media.map((item) => [item.key, item])).values()]
}

export function createOfflineStore(deps: OfflineStoreDeps): OfflineStore {
  const listeners = new Set<() => void>()
  const inflight = new Map<string, Promise<OfflineTestRecord>>()
  let current: readonly OfflineTestRecord[] = []
  let dbPromise: Promise<IDBDatabase> | undefined = undefined
  // Bumped when another context deletes the database (sign-out purge), so a
  // download that straddles the purge cannot write its record afterwards.
  let generation = 0

  function emit(): void {
    for (const listener of listeners) {
      listener()
    }
  }

  function getDb(): Promise<IDBDatabase> {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(deps.dbName, 1)

      request.onupgradeneeded = () => {
        request.result.createObjectStore(TESTS_STORE, { keyPath: "slug" })
      }
      request.onsuccess = () => {
        const db = request.result

        // `deleteDatabase` (purge) fires this; closing lets it proceed. The
        // next call reopens a fresh, empty database.
        db.onversionchange = () => {
          db.close()
          dbPromise = undefined
          generation += 1
          current = []
          emit()
        }
        resolve(db)
      }
      request.onerror = () => {
        dbPromise = undefined
        reject(request.error ?? new Error("IndexedDB open failed"))
      }
    })

    return dbPromise
  }

  async function readAll(): Promise<StoredTest[]> {
    const db = await getDb()

    return promisify(
      db
        .transaction(TESTS_STORE)
        .objectStore(TESTS_STORE)
        .getAll() as IDBRequest<StoredTest[]>,
    )
  }

  async function refresh(): Promise<void> {
    const stored = await readAll()

    current = stored
      .map((item) => item.record)
      .sort((a, b) => a.title.localeCompare(b.title))
    emit()
  }

  // IndexedDB unavailable (private mode) behaves as "nothing saved".
  const ready = refresh().catch(() => undefined)

  async function removeKeys(keys: Iterable<string>): Promise<void> {
    const cache = await deps.cacheStorage.open(deps.cacheName)

    await Promise.all([...keys].map((key) => cache.delete(mediaKey(key))))
  }

  /** Media keys referenced by every saved test except `excludeSlug`. */
  async function keysUsedByOthers(excludeSlug: string): Promise<Set<string>> {
    const others = (await readAll()).filter((s) => s.slug !== excludeSlug)

    return new Set(others.flatMap((s) => s.bundle.media.map((m) => m.key)))
  }

  async function streamIntoCache(
    cache: OfflineCache,
    item: OfflineMedia,
    io: { signal: AbortSignal; onBytes: (n: number) => void },
  ): Promise<void> {
    const { signal, onBytes } = io
    const response = await deps
      .fetchMedia(item.url, signal)
      .catch((error: unknown) => {
        if (signal.aborted || isAbortError(error)) {
          throw error
        }

        throw new OfflineDownloadError(
          `media ${item.key} could not be fetched`,
          "network",
        )
      })

    if (!response.ok || !response.body) {
      throw new OfflineDownloadError(
        `media ${item.key} returned ${response.status}`,
        "http",
      )
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []

    try {
      for (;;) {
        signal.throwIfAborted()

        // oxlint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        chunks.push(value)
        onBytes(value.byteLength)
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined)

      if (signal.aborted || isAbortError(error)) {
        throw error
      }

      throw new OfflineDownloadError(
        `media ${item.key} stream was interrupted`,
        "network",
      )
    }

    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
    let offset = 0

    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }

    await cache.put(
      mediaKey(item.key),
      new Response(bytes, { headers: { "content-type": item.mimeType } }),
    )
  }

  async function runDownload(
    slug: string,
    opts: { onProgress(p: DownloadProgress): void; signal: AbortSignal },
  ): Promise<OfflineTestRecord> {
    const startedIn = generation
    const bundle = await deps.fetchBundle(slug)
    const media = uniqueMedia(bundle)
    const totalBytes = media.reduce((sum, item) => sum + item.bytes, 0)
    const cache = await deps.cacheStorage.open(deps.cacheName)
    const written: string[] = []
    const progress = { doneBytes: 0 }

    try {
      for (const item of media) {
        // oxlint-disable-next-line no-await-in-loop
        await streamIntoCache(cache, item, {
          signal: opts.signal,
          onBytes: (n) => {
            // The manifest's byte counts are advisory: never report over 100%.
            progress.doneBytes = Math.min(progress.doneBytes + n, totalBytes)
            opts.onProgress({ doneBytes: progress.doneBytes, totalBytes })
            opts.signal.throwIfAborted()
          },
        })
        written.push(item.key)
      }

      opts.signal.throwIfAborted()

      if (generation !== startedIn) {
        throw new DOMException("Saved tests were cleared", "AbortError")
      }
    } catch (error) {
      // Keep anything another saved test (or this slug's previous save) uses.
      const used = await keysUsedByOthers("")

      await removeKeys(written.filter((key) => !used.has(key)))
      throw isAbortError(error) || !opts.signal.aborted
        ? error
        : new DOMException("The download was aborted", "AbortError")
    }

    const record: OfflineTestRecord = {
      slug: bundle.slug,
      testVersionId: bundle.testVersionId,
      version: bundle.version,
      title: bundle.title,
      level: bundle.level,
      totalBytes,
      savedAt: deps.now().toISOString(),
    }
    const previous = (await readAll()).find((s) => s.slug === slug)
    const db = await getDb()
    const tx = db.transaction(TESTS_STORE, "readwrite")

    tx.objectStore(TESTS_STORE).put({ slug: bundle.slug, record, bundle })
    await settle(tx)

    if (previous) {
      // A re-save of a newer version: drop files only the old one used.
      const keep = await keysUsedByOthers("")

      await removeKeys(
        previous.bundle.media.map((m) => m.key).filter((k) => !keep.has(k)),
      )
    }

    await refresh()

    return record
  }

  return {
    async list() {
      await ready

      return [...current]
    },
    snapshot: () => current,
    whenReady: () => ready,
    async has(slug) {
      await ready

      return current.some((record) => record.slug === slug)
    },
    async getBundle(slug) {
      const db = await getDb()
      const stored = await promisify(
        db
          .transaction(TESTS_STORE)
          .objectStore(TESTS_STORE)
          .get(slug) as IDBRequest<StoredTest | undefined>,
      )

      return stored?.bundle ?? null
    },
    async getMediaBlob(key) {
      const cache = await deps.cacheStorage.open(deps.cacheName)
      const response = await cache.match(mediaKey(key))

      return response ? response.blob() : null
    },
    download(slug, opts) {
      const existing = inflight.get(slug)

      if (existing) {
        return existing
      }

      const run = runDownload(slug, opts).finally(() => {
        inflight.delete(slug)
      })

      inflight.set(slug, run)

      return run
    },
    async remove(slug) {
      const all = await readAll()
      const target = all.find((s) => s.slug === slug)

      if (!target) {
        return
      }

      const stillUsed = await keysUsedByOthers(slug)
      const db = await getDb()
      const tx = db.transaction(TESTS_STORE, "readwrite")

      tx.objectStore(TESTS_STORE).delete(slug)
      await settle(tx)
      await removeKeys(
        target.bundle.media
          .map((m) => m.key)
          .filter((key) => !stillUsed.has(key)),
      )
      await refresh()
    },
    async removeAll() {
      const all = await readAll()
      const db = await getDb()
      const tx = db.transaction(TESTS_STORE, "readwrite")

      tx.objectStore(TESTS_STORE).clear()
      await settle(tx)
      await removeKeys(all.flatMap((s) => s.bundle.media.map((m) => m.key)))
      await refresh()
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
  }
}

// The names `purgeClientCaches()` (lib/pwa/purge.ts) deletes on sign-out.
const DB_NAME = "pp-offline"
const CACHE_NAME = "pp-offline-media-v1"

let instance: OfflineStore | undefined = undefined

function getInstance(): OfflineStore {
  instance ??= createOfflineStore({
    dbName: DB_NAME,
    cacheName: CACHE_NAME,
    fetchBundle: getOfflineBundle,
    fetchMedia: (url, signal) => fetch(url, { signal }),
    cacheStorage: caches,
    now: () => new Date(),
  })

  return instance
}

// A lazy facade: `offlineStore.x` forwards to the real instance, created on
// first use, so importing this module opens nothing (tests, SSR).
export const offlineStore: OfflineStore = {
  list: () => getInstance().list(),
  snapshot: () => getInstance().snapshot(),
  whenReady: () => getInstance().whenReady(),
  has: (slug) => getInstance().has(slug),
  getBundle: (slug) => getInstance().getBundle(slug),
  getMediaBlob: (key) => getInstance().getMediaBlob(key),
  download: (slug, opts) => getInstance().download(slug, opts),
  remove: (slug) => getInstance().remove(slug),
  removeAll: () => getInstance().removeAll(),
  subscribe: (listener) => getInstance().subscribe(listener),
}
