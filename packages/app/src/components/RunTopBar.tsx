import type { RefObject } from "react"
import { useTranslation } from "react-i18next"
import type { SectionType } from "../lib/api-types.js"
import { formatCountdown } from "../lib/countdown.js"
import { Icon } from "./Icon.js"
import { SaveState, type SaveStateProps } from "./SaveState.js"

const LOW_MS = 60_000

/** The prototype's low-time threshold: one minute or less, clock running. */
export function isLowTime(remainingMs: number | null): boolean {
  return remainingMs !== null && remainingMs <= LOW_MS
}

export interface RunTopBarProps {
  readonly sectionType: SectionType
  readonly saveState: SaveStateProps
  readonly remainingMs: number | null
  readonly answered: number
  readonly total: number
  readonly menuExpanded: boolean
  readonly menuTriggerRef?: RefObject<HTMLButtonElement | null>
  /**
   * The polite live region for "One minute left.". Rendered empty and
   * written by the page: an open sheet aria-hides this whole subtree, so only
   * the page knows when the message can actually be heard (see run.tsx).
   */
  readonly announcementRef?: RefObject<HTMLParagraphElement | null>
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
  announcementRef,
  onOpenMenu,
}: RunTopBarProps) {
  const { t } = useTranslation("runner")
  const low = isLowTime(remainingMs)

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
          text is never read out. This always-present, initially empty region
          is where the page writes the one-minute warning. A bare live region
          rather than role="status", so the save chip stays the screen's one
          status. */}
      <p
        ref={announcementRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
    </header>
  )
}
