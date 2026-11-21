import type { RefObject } from "react"
import { useTranslation } from "react-i18next"
import type { SectionType } from "../lib/api-types.js"
import { formatCountdown } from "../lib/countdown.js"
import { Icon } from "./Icon.js"
import { SaveState, type SaveStateProps } from "./SaveState.js"

const LOW_MS = 60_000

export interface RunTopBarProps {
  readonly sectionType: SectionType
  readonly saveState: SaveStateProps
  readonly remainingMs: number | null
  readonly answered: number
  readonly total: number
  readonly menuExpanded: boolean
  readonly menuTriggerRef?: RefObject<HTMLButtonElement | null>
  readonly onOpenMenu: () => void
}

export function RunTopBar({
  sectionType,
  saveState,
  remainingMs,
  answered,
  total,
  menuExpanded,
  menuTriggerRef,
  onOpenMenu,
}: RunTopBarProps) {
  const { t } = useTranslation("runner")
  const low = remainingMs !== null && remainingMs <= LOW_MS
  const announceLow = remainingMs !== null && remainingMs > 0 && low

  return (
    <header className="m-runtop">
      <div className="m-row">
        <button
          ref={menuTriggerRef}
          type="button"
          aria-label={t("menu.openLabel")}
          aria-expanded={menuExpanded}
          aria-haspopup="dialog"
          className="m-iconbtn runner-panel-trigger runner-menu-trigger"
          onClick={onOpenMenu}
        >
          <Icon name="more" />
        </button>
        <span
          className={`section-chip section-chip--${sectionType}`}
          data-section={sectionType}
        >
          {t(`runner.sectionChip.${sectionType}`)}
        </span>
        <span className="grow" />
        <SaveState {...saveState} />
        {remainingMs !== null ? (
          <span
            role="timer"
            aria-label={t("runner.timeRemaining")}
            className="m-timer"
            data-low={low ? "true" : undefined}
          >
            {low ? <Icon name="clock" small /> : null}
            <span>{formatCountdown(remainingMs)}</span>
          </span>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-label={t("runner.sectionProgress")}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answered}
        className="m-progress"
      >
        <i style={{ width: `${total > 0 ? (100 * answered) / total : 0}%` }} />
      </div>
      {/* The timer itself is role="timer" (aria-live off), so its every-second
          text is never read out; this region speaks once, when the minute
          mark is crossed. A bare live region rather than role="status", so
          the save chip stays the screen's one status. */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announceLow ? t("runner.oneMinuteLeft") : ""}
      </p>
    </header>
  )
}
