import { useId, type JSX } from "react"
import { useTranslation } from "react-i18next"
import type { ReminderState } from "../lib/reminders.js"
import { Icon } from "./Icon.js"

export interface RemindersRowProps {
  readonly state: ReminderState
  readonly busy?: boolean
  readonly onToggle: (next: boolean) => void
}

const BLOCKED_KEY: Partial<Record<ReminderState, string>> = {
  denied: "profile.reminders.denied",
  "needs-install": "profile.reminders.needsInstall",
  unsupported: "profile.reminders.unsupported",
}

/** Prototype `vProfile()` reminders row (`.li` + `.switch`). */
export function RemindersRow({
  state,
  busy = false,
  onToggle,
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
        <small id={descriptionId}>{t(description)}</small>
      </div>
      <span className="switch">
        <input
          type="checkbox"
          role="switch"
          aria-label={t("profile.reminders.title")}
          aria-describedby={descriptionId}
          checked={state === "on"}
          disabled={blockedKey !== undefined || busy}
          onChange={(event) => {
            onToggle(event.currentTarget.checked)
          }}
        />
        <i />
      </span>
    </div>
  )
}
