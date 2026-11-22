import { useSyncExternalStore } from "react"
import { syncStatus, type SyncStatusSnapshot } from "./sync-status.js"

export function useSyncStatus(): SyncStatusSnapshot {
  return useSyncExternalStore(
    (listener) => syncStatus.subscribe(listener),
    () => syncStatus.getSnapshot(),
    () => syncStatus.getSnapshot(),
  )
}
