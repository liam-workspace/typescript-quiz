import { useMemo, useSyncExternalStore } from "react"
import i18n from "../../i18n.js"
import { networkStore } from "../network.js"
import { toastStore } from "../toast.js"
import {
  OfflineDownloadError,
  offlineStore,
  type OfflineTestRecord,
} from "./offline-store.js"

export interface OfflineLibraryApi {
  readonly saved: ReadonlyMap<string, OfflineTestRecord>
  readonly progressPercent: ReadonlyMap<string, number>
  readonly online: boolean
  save(slug: string, title: string): void
  remove(slug: string, title: string): void
}

// Saves are owned here, per slug, at module level -- not by the hook that
// started them. `offlineStore.download` hands a second caller of the same slug
// the first call's promise (its signal and onProgress are ignored), so a
// remounted card must read the progress of the one real download instead of
// starting another. The map below is replaced (never mutated) on each change
// so `useSyncExternalStore` sees a stable snapshot between changes.
let progress: ReadonlyMap<string, number> = new Map()
const controllers = new Map<string, AbortController>()
const listeners = new Set<() => void>()
let unwatchNetwork: (() => void) | undefined = undefined

function setProgress(slug: string, percent: number | null): void {
  const next = new Map(progress)

  if (percent === null) {
    next.delete(slug)
  } else {
    next.set(slug, percent)
  }

  progress = next

  for (const listener of [...listeners]) {
    listener()
  }
}

const subscribeProgress = (listener: () => void): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

const getProgress = (): ReadonlyMap<string, number> => progress

const isOnline = (): boolean => networkStore.getSnapshot().online

/** Going offline pauses every save; they end in an AbortError handled below. */
function watchNetwork(): void {
  unwatchNetwork ??= networkStore.subscribe(() => {
    if (!isOnline()) {
      for (const controller of controllers.values()) {
        controller.abort()
      }
    }
  })
}

function settleSave(slug: string): void {
  controllers.delete(slug)
  setProgress(slug, null)

  if (controllers.size === 0) {
    unwatchNetwork?.()
    unwatchNetwork = undefined
  }
}

function toastSaveFailure(
  error: unknown,
  signal: AbortSignal,
  title: string,
): void {
  // Ours (network dropped) or the connection died mid-save: resumable, so say
  // "paused". A purge abort, an http refusal or no Cache Storage is a failure.
  const paused =
    signal.aborted ||
    (error instanceof OfflineDownloadError && error.reason === "network")

  toastStore.show(
    paused
      ? i18n.t("runner:toast.savePaused")
      : i18n.t("runner:offline.saveFailed", { title }),
    paused ? "wifioff" : "alert",
  )
}

// Test-only: forget every save (aborting those in flight) between tests.
export function resetOfflineLibraryForTests(): void {
  for (const controller of controllers.values()) {
    controller.abort()
  }

  controllers.clear()
  listeners.clear()
  progress = new Map()
  unwatchNetwork?.()
  unwatchNetwork = undefined
}

function startSave(slug: string, title: string): void {
  if (controllers.has(slug) || !isOnline()) {
    return
  }

  const controller = new AbortController()

  controllers.set(slug, controller)
  watchNetwork()
  setProgress(slug, 0)

  offlineStore
    .download(slug, {
      signal: controller.signal,
      onProgress: ({ doneBytes, totalBytes }) => {
        setProgress(
          slug,
          totalBytes > 0
            ? Math.min(100, Math.round((100 * doneBytes) / totalBytes))
            : 100,
        )
      },
    })
    .then(() => {
      toastStore.show(i18n.t("runner:toast.savedOffline", { title }), "cloud")
    })
    .catch((error: unknown) => {
      toastSaveFailure(error, controller.signal, title)
    })
    .finally(() => {
      settleSave(slug)
    })
}

function removeSaved(slug: string, title: string): void {
  offlineStore
    .remove(slug)
    .then(() => {
      toastStore.show(i18n.t("runner:toast.removedOffline", { title }), "trash")
    })
    .catch(() => {
      toastStore.show(i18n.t("runner:offline.removeFailed", { title }), "alert")
    })
}

/**
 * Page-level state for the library and profile screens (components/ stay
 * stateless): saved records, per-slug save progress, and the connection.
 */
export function useOfflineLibrary(): OfflineLibraryApi {
  const records = useSyncExternalStore(
    (listener) => offlineStore.subscribe(listener),
    () => offlineStore.snapshot(),
    () => offlineStore.snapshot(),
  )
  const online = useSyncExternalStore(
    (listener) => networkStore.subscribe(listener),
    isOnline,
    () => true,
  )
  const progressPercent = useSyncExternalStore(
    subscribeProgress,
    getProgress,
    getProgress,
  )
  const saved = useMemo(
    () => new Map(records.map((record) => [record.slug, record])),
    [records],
  )

  return {
    saved,
    progressPercent,
    online,
    save: startSave,
    remove: removeSaved,
  }
}
