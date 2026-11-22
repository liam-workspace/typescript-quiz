import type { JSX, RefObject } from "react"
import { useTranslation } from "react-i18next"
import { BottomSheet } from "./BottomSheet.js"

export interface ReminderPermissionSheetProps {
  readonly open: boolean
  /** True while the browser's permission prompt / subscribe is in flight. */
  readonly busy: boolean
  readonly onAllow: () => void
  readonly onDecline: () => void
  readonly returnFocusRef?: RefObject<HTMLElement | null>
  /** Focused on close instead when the switch ended disabled (denied…). */
  readonly fallbackFocusRef?: RefObject<HTMLElement | null>
}

/**
 * Prototype `notif` sheet: the soft ask in front of the browser's one-shot
 * permission prompt. "Don't allow" here only closes it (a denial at the
 * browser prompt is sticky; a "no" here costs nothing).
 */
export function ReminderPermissionSheet({
  open,
  busy,
  onAllow,
  onDecline,
  returnFocusRef,
  fallbackFocusRef,
}: ReminderPermissionSheetProps): JSX.Element {
  const { t } = useTranslation("runner")

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        // While the browser prompt / subscribe is in flight, Escape or the
        // close button must not pull the sheet out from under it.
        if (!next && !busy) {
          onDecline()
        }
      }}
      title={t("profile.reminders.permission.title")}
      closeLabel={t("pwa.sheet.close")}
      returnFocusRef={returnFocusRef}
      fallbackFocusRef={fallbackFocusRef}
    >
      <p className="reason">{t("profile.reminders.permission.body")}</p>
      <div className="btnrow">
        <button
          type="button"
          className="btn"
          disabled={busy}
          aria-busy={busy}
          onClick={onAllow}
        >
          {t("profile.reminders.permission.allow")}
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={onDecline}
        >
          {t("profile.reminders.permission.deny")}
        </button>
      </div>
    </BottomSheet>
  )
}
