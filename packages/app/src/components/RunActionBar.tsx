import type { RefObject } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./Icon.js"

export interface RunPrimaryAction {
  readonly kind: "next" | "finish" | "handIn"
  readonly label: string
  readonly disabled: boolean
  /** Why it is disabled, when something on screen says so. */
  readonly describedBy?: string
}

export interface RunActionBarProps {
  readonly showPrevious: boolean
  /** Shown but inert (the first question of a free section): no layout jump. */
  readonly previousDisabled?: boolean
  readonly onPrevious: () => void
  readonly answered: number
  readonly total: number
  readonly navigatorExpanded: boolean
  readonly navigatorTriggerRef?: RefObject<HTMLButtonElement | null>
  readonly onOpenNavigator: () => void
  readonly primary: RunPrimaryAction | null
  readonly onPrimary: () => void
  /** The confirm sheet Finish opens returns focus here. */
  readonly primaryRef?: RefObject<HTMLButtonElement | null>
}

export function RunActionBar({
  showPrevious,
  previousDisabled = false,
  onPrevious,
  answered,
  total,
  navigatorExpanded,
  navigatorTriggerRef,
  onOpenNavigator,
  primary,
  onPrimary,
  primaryRef,
}: RunActionBarProps) {
  const { t } = useTranslation("runner")

  return (
    <footer className="m-actionbar" data-sticky="true">
      {showPrevious ? (
        <button
          type="button"
          className="m-btn"
          data-variant="secondary"
          aria-label={t("runner.previous")}
          style={{ flex: "0 0 56px" }}
          disabled={previousDisabled}
          onClick={onPrevious}
        >
          <Icon name="back" />
        </button>
      ) : null}
      <button
        ref={navigatorTriggerRef}
        type="button"
        // The name carries the visible count (WCAG 2.5.3, label in name).
        aria-label={t("navigator.openLabel", { answered, total })}
        aria-expanded={navigatorExpanded}
        aria-haspopup="dialog"
        className="m-btn nav-toggle runner-panel-trigger runner-navigator-trigger"
        data-variant="secondary"
        style={{ flex: "0 0 auto" }}
        onClick={onOpenNavigator}
      >
        <Icon name="grid" />
        <span>
          {answered}/{total}
        </span>
      </button>
      {primary ? (
        <button
          ref={primaryRef}
          type="button"
          className="m-btn"
          data-kind={primary.kind}
          disabled={primary.disabled}
          aria-describedby={primary.describedBy}
          onClick={onPrimary}
        >
          {primary.label}
        </button>
      ) : null}
    </footer>
  )
}
