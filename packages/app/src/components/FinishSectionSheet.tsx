import type { RefObject } from "react"
import { useTranslation } from "react-i18next"
import { BottomSheet } from "./BottomSheet.js"

export interface FinishSectionSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly sectionLabel: string
  readonly blankCount: number
  readonly busy: boolean
  readonly failed: boolean
  readonly onConfirm: () => void
  readonly returnFocusRef?: RefObject<HTMLElement | null>
  /** Takes focus on close when the trigger is disabled (busy finishing). */
  readonly fallbackFocusRef?: RefObject<HTMLElement | null>
}

export function FinishSectionSheet({
  open,
  onOpenChange,
  sectionLabel,
  blankCount,
  busy,
  failed,
  onConfirm,
  returnFocusRef,
  fallbackFocusRef,
}: FinishSectionSheetProps) {
  const { t } = useTranslation("runner")

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("runner.finishSectionTitle", { section: sectionLabel })}
      closeLabel={t("menu.closeLabel")}
      returnFocusRef={returnFocusRef}
      fallbackFocusRef={fallbackFocusRef}
    >
      <p>
        {blankCount > 0
          ? t("runner.finishSectionBlank", { count: blankCount })
          : t("runner.finishSectionNoBlank")}
      </p>
      {failed ? (
        <p role="alert" className="m-alert mt-3">
          {t("runner.sectionTransitionError")}
        </p>
      ) : null}
      <div className="m-sheet-actions">
        <button
          type="button"
          className="m-btn"
          disabled={busy}
          aria-busy={busy}
          onClick={onConfirm}
        >
          {t("runner.finishSectionButton", { section: sectionLabel })}
        </button>
        <button
          type="button"
          className="m-btn"
          data-variant="secondary"
          onClick={() => {
            onOpenChange(false)
          }}
        >
          {t("handIn.keepWorking")}
        </button>
      </div>
    </BottomSheet>
  )
}
