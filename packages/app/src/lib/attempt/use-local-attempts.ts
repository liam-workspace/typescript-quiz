import { useEffect, useState } from "react"
import { currentSubject, isOwnedBy } from "./owner.js"
import { getAttemptRuntime } from "./runtime.js"

const NONE: ReadonlySet<string> = new Set()

/** A library list fetched ONLINE just now: what the server says is in progress. */
export interface FreshLibraryList {
  readonly tests: ReadonlyArray<{
    readonly slug: string
    readonly inProgressAttemptId: string | null
  }>
  /** No further pages: every test is in `tests`. */
  readonly complete: boolean
}

/**
 * The ids of the signed-in student's unfinished attempts this device holds
 * state for -- what "Continue" can do without a connection. Another
 * student's attempts on a shared device are never included. Given a fresh
 * online list, copies the server fully holds and no longer shows in progress
 * are pruned first (an offline Start must not resume one: all its work
 * would be late).
 */
export function useLocalAttemptIds(
  fresh: FreshLibraryList | null = null,
): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(NONE)

  useEffect(() => {
    let cancelled = false

    void getAttemptRuntime()
      .then(async ({ journal, local }) => {
        if (fresh) {
          await local.pruneSettledNotInProgress(fresh).catch(() => undefined)
        }

        return journal.listAttempts()
      })
      .then((attempts) => {
        if (cancelled) {
          return
        }

        const me = currentSubject()

        setIds(
          new Set(
            attempts
              .filter((a) => isOwnedBy(a, me) && a.finalized === null)
              .map((a) => a.attemptId),
          ),
        )
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [fresh])

  return ids
}
