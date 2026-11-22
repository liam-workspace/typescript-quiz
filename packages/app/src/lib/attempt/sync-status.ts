export interface SyncStatusSnapshot {
  readonly syncing: boolean
  /** The signed-in student's attempts with journal events not yet on the server. */
  readonly pendingAttempts: number
  readonly pendingEvents: number
  /** Attempts whose journal the server refused for good (kept on the phone). */
  readonly failedAttemptIds: readonly string[]
}

export interface SyncStatusStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): SyncStatusSnapshot
  set(next: SyncStatusSnapshot): void
}

const IDLE: SyncStatusSnapshot = {
  syncing: false,
  pendingAttempts: 0,
  pendingEvents: 0,
  failedAttemptIds: [],
}

const same = (a: SyncStatusSnapshot, b: SyncStatusSnapshot): boolean =>
  a.syncing === b.syncing &&
  a.pendingAttempts === b.pendingAttempts &&
  a.pendingEvents === b.pendingEvents &&
  a.failedAttemptIds.join(",") === b.failedAttemptIds.join(",")

/** `getSnapshot()` is reference-stable until a field changes (useSyncExternalStore). */
export function createSyncStatusStore(): SyncStatusStore {
  let current = IDLE
  const listeners = new Set<() => void>()

  return {
    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => current,
    set(next) {
      if (same(current, next)) {
        return
      }

      current = next

      for (const listener of [...listeners]) {
        listener()
      }
    },
  }
}

export const syncStatus: SyncStatusStore = createSyncStatusStore()
