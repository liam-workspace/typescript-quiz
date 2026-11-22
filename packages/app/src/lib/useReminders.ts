import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ReminderError,
  reminders,
  type ReminderFailure,
  type RemindersApi,
  type ReminderState,
} from "./reminders.js"
import { toastStore } from "./toast.js"

/** What the row explains under the switch after a change failed. */
export type ReminderProblem =
  | Exclude<ReminderFailure, "browser-refused">
  | "disable"

export interface UseRemindersResult {
  readonly state: ReminderState
  readonly busy: boolean
  /** The last change failed; cleared by the next one. */
  readonly problem: ReminderProblem | null
  readonly sheetOpen: boolean
  /** The switch's onChange: `true` asks first (sheet), `false` turns off at once. */
  readonly toggle: (next: boolean) => void
  readonly allow: () => Promise<void>
  readonly decline: () => void
}

/**
 * Owns the reminders switch for the Profile page (lib/, because components
 * are props-only). Every outcome ends with `state` re-read from the browser,
 * so the switch never claims "on" while nothing would be sent.
 */
export function useReminders(
  api: RemindersApi = reminders,
): UseRemindersResult {
  const { t } = useTranslation("runner")
  const [state, setState] = useState<ReminderState>("off")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<ReminderProblem | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const alive = useRef(true)
  // Bumped by every change, so a refresh that started before it cannot
  // overwrite the change's outcome with what the browser said earlier.
  const generation = useRef(0)

  const refresh = useCallback((): Promise<void> => {
    const started = generation.current

    return api.state().then(
      (next) => {
        if (alive.current && started === generation.current) {
          setState(next)
        }
      },
      () => undefined,
    )
  }, [api])

  useEffect(() => {
    alive.current = true
    void refresh()

    // The student may flip the permission in browser settings and come back.
    const onVisible = (): void => {
      if (document.visibilityState === "visible") {
        void refresh()
      }
    }

    document.addEventListener("visibilitychange", onVisible)

    return () => {
      alive.current = false
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [refresh])

  const settle = useCallback(
    (next: ReminderState | null): Promise<void> => {
      generation.current += 1

      if (next !== null) {
        setState(next)

        return Promise.resolve()
      }

      return refresh()
    },
    [refresh],
  )

  const toggle = useCallback(
    (next: boolean): void => {
      if (busy) {
        return
      }

      if (next) {
        if (state === "off") {
          setProblem(null)
          setSheetOpen(true)
        }

        return
      }

      if (state !== "on") {
        return
      }

      setProblem(null)
      setBusy(true)
      generation.current += 1

      void api
        .disable()
        .then(
          async (after) => {
            await settle(after)

            if (after === "on") {
              setProblem("disable")
            } else {
              toastStore.show(t("toast.remindersOff"), "bell")
            }
          },
          async () => {
            await settle(null)
            setProblem("disable")
          },
        )
        .finally(() => {
          if (alive.current) {
            setBusy(false)
          }
        })
    },
    [api, busy, settle, state, t],
  )

  const allow = useCallback(async (): Promise<void> => {
    setBusy(true)
    generation.current += 1

    try {
      const after = await api.enable()

      setSheetOpen(false)
      await settle(after)

      if (after === "on") {
        toastStore.show(t("toast.remindersOn"), "bell")
      } else if (after === "denied") {
        toastStore.show(t("toast.remindersBlocked"), "bell")
      }
    } catch (error) {
      const reason = error instanceof ReminderError ? error.reason : "failed"

      setSheetOpen(false)
      // The library rolled back any browser subscription; read the truth.
      await settle(null)

      if (reason === "browser-refused") {
        // The row now reads "unsupported"; say so for the tap just made.
        toastStore.show(t("profile.reminders.unsupported"), "bell")
      } else {
        setProblem(reason)
      }
    } finally {
      if (alive.current) {
        setBusy(false)
      }
    }
  }, [api, settle, t])

  const decline = useCallback((): void => {
    // A "no" to the soft ask costs nothing: no denied state, no toast.
    setSheetOpen(false)
  }, [])

  return { state, busy, problem, sheetOpen, toggle, allow, decline }
}
