import { useCallback, useEffect, useRef, useState } from "react"
import type { SyncStatusSnapshot } from "./sync-status.js"

export interface WaitingData {
  readonly waiting?: true
}

export interface WaitingRecheckInput<T extends WaitingData> {
  readonly attemptId: string
  /** What the route loaded. */
  readonly data: T
  readonly status: SyncStatusSnapshot
  readonly online: boolean
  /** Re-asks for the screen's data; rejects when the server cannot answer. */
  readonly load: (attemptId: string) => Promise<T>
  /** Asks the sync engine to send now (Check again). */
  readonly requestSync?: () => Promise<void>
}

export interface WaitingRecheck<T extends WaitingData> {
  readonly data: T
  readonly syncFailed: boolean
  /** The latest re-check failed and nothing is left to send: retryable. */
  readonly checkFailed: boolean
  readonly checkAgain: () => void
}

/**
 * While a screen waits for this phone's journal to reach the server, looks
 * again (no reload) whenever the sync status changes and nothing is syncing,
 * the journal was not refused and the phone is online -- so the waiting
 * screen turns into the real one by itself. At most one check runs at a
 * time, and a check that still reports "waiting" does not trigger another
 * (only a status change does), so it cannot loop.
 */
export function useWaitingRecheck<T extends WaitingData>({
  attemptId,
  data: loaded,
  status,
  online,
  load,
  requestSync,
}: WaitingRecheckInput<T>): WaitingRecheck<T> {
  const [fresh, setFresh] = useState<{
    readonly attemptId: string
    readonly data: T
  } | null>(null)
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const checking = useRef(false)
  const latest = useRef({ load, requestSync })

  useEffect(() => {
    latest.current = { load, requestSync }
  })

  const data = fresh?.attemptId === attemptId ? fresh.data : loaded
  const syncFailed = status.failedAttemptIds.includes(attemptId)

  const check = useCallback(
    async (sendFirst: boolean): Promise<void> => {
      if (checking.current) {
        return
      }

      checking.current = true

      try {
        if (sendFirst) {
          await latest.current.requestSync?.().catch(() => undefined)
        }

        setFresh({ attemptId, data: await latest.current.load(attemptId) })
        setFailedFor(null)
      } catch {
        setFailedFor(attemptId)
      } finally {
        checking.current = false
      }
    },
    [attemptId],
  )

  useEffect(() => {
    if (data.waiting && !status.syncing && !syncFailed && online) {
      // Off the effect's synchronous path: the check sets state.
      void Promise.resolve().then(() => check(false))
    }
  }, [check, data.waiting, status, syncFailed, online])

  return {
    data,
    syncFailed,
    checkFailed: failedFor === attemptId && status.pendingAttempts === 0,
    checkAgain: () => {
      void check(true)
    },
  }
}
