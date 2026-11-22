import { useId, type JSX, type RefObject } from "react"
import { useTranslation } from "react-i18next"
import type { ReminderState } from "../lib/reminders.js"
import type { ReminderProblem } from "../lib/useReminders.js"
import { Icon } from "./Icon.js"

export interface RemindersRowProps {
  readonly state: ReminderState
  readonly busy?: boolean
  /** Why the last change failed, announced under the row. */
  readonly problem?: ReminderProblem | null
  readonly onToggle: (next: boolean) => void
  readonly switchRef?: RefObject<HTMLInputElement | null>
  /**
   * The status line, focusable from script only: focus lands here when a
   * sheet closes and the switch is disabled.
   */
  readonly statusRef?: RefObject<HTMLElement | null>
}

const BLOCKED_KEY: Partial<Record<ReminderState, string>> = {
  denied: "profile.reminders.denied",
  "needs-install": "profile.reminders.needsInstall",
  unsupported: "profile.reminders.unsupported",
}

const PROBLEM_KEY: Record<ReminderProblem, string> = {
  failed: "profile.reminders.error.failed",
  offline: "profile.reminders.error.offline",
  "not-configured": "profile.reminders.error.notConfigured",
  conflict: "profile.reminders.error.conflict",
  disable: "profile.reminders.error.disable",
}

/**
 * Prototype `vProfile()` reminders row (`.li` + `.switch`). Only off/on can
 * be changed; every other state is a reason shown in place of a dead switch.
 */
export function RemindersRow({
  state,
  busy = false,
  problem = null,
  onToggle,
  switchRef,
  statusRef,
}: RemindersRowProps): JSX.Element {
  const { t } = useTranslation("runner")
  const descriptionId = useId()
  const blockedKey = BLOCKED_KEY[state]
  const description =
    blockedKey ??
    (state === "on" ? "profile.reminders.on" : "profile.reminders.off")

  return (
    <div className="li">
      <span className="ticon">
        <Icon name="bell" />
      </span>
      <div className="t">
        {t("profile.reminders.title")}
        <small id={descriptionId} ref={statusRef} tabIndex={-1}>
          {t(description)}
        </small>
        {problem ? (
          <small role="alert" className="text-bad">
            {t(PROBLEM_KEY[problem])}
          </small>
        ) : null}
      </div>
      <span className="switch">
        <input
          ref={switchRef}
          type="checkbox"
          role="switch"
          aria-label={t("profile.reminders.title")}
          aria-describedby={descriptionId}
          checked={state === "on"}
          disabled={blockedKey !== undefined || busy}
          aria-busy={busy}
          onChange={(event) => {
            onToggle(event.currentTarget.checked)
          }}
        />
        <i />
      </span>
    </div>
  )
}
