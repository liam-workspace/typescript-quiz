import { useEffect, useState } from "react"
import { currentSubject, isOwnedBy } from "./owner.js"
import { getAttemptRuntime } from "./runtime.js"

const NONE: ReadonlySet<string> = new Set()

/**
 * The ids of the signed-in student's unfinished attempts this device holds
 * state for -- what "Continue" can do without a connection. Another
 * student's attempts on a shared device are never included.
 */
export function useLocalAttemptIds(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(NONE)

  useEffect(() => {
    let cancelled = false

    void getAttemptRuntime()
      .then(({ journal }) => journal.listAttempts())
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
  }, [])

  return ids
}
