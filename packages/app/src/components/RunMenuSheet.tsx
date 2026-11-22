import type { RefObject } from "react"
import { useTranslation } from "react-i18next"
import { BottomSheet } from "./BottomSheet.js"

export interface RunMenuSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** `envelope.expiresAt !== null` — the clock does not start with the attempt. */
  readonly clockStarted: boolean
  readonly onLeave: () => void
  readonly returnFocusRef?: RefObject<HTMLElement | null>
}

export function RunMenuSheet({
  open,
  onOpenChange,
  clockStarted,
  onLeave,
  returnFocusRef,
}: RunMenuSheetProps) {
  const { t } = useTranslation("runner")

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("menu.title")}
      closeLabel={t("menu.closeLabel")}
      returnFocusRef={returnFocusRef}
    >
      <p className="m-reason">
        {t(
          clockStarted
            ? "menu.leaveTestNoteRunning"
            : "menu.leaveTestNoteBeforeStart",
        )}
      </p>
      <div className="m-sheet-actions">
        <button
          type="button"
          className="m-btn"
          data-variant="secondary"
          onClick={onLeave}
        >
          {t("menu.leaveTest")}
        </button>
        <button
          type="button"
          className="m-btn"
          data-variant="ghost"
          onClick={() => {
            onOpenChange(false)
          }}
        >
          {t("runner.backToTest")}
        </button>
      </div>
    </BottomSheet>
  )
}
