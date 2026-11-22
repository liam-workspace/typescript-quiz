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
  readonly onPrevious: () => void
  readonly answered: number
  readonly total: number
  readonly navigatorExpanded: boolean
  readonly navigatorTriggerRef?: RefObject<HTMLButtonElement | null>
  readonly onOpenNavigator: () => void
  readonly primary: RunPrimaryAction | null
  readonly onPrimary: () => void
}

export function RunActionBar({
  showPrevious,
  onPrevious,
  answered,
  total,
  navigatorExpanded,
  navigatorTriggerRef,
  onOpenNavigator,
  primary,
  onPrimary,
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
          onClick={onPrevious}
        >
          <Icon name="back" />
        </button>
      ) : null}
      <button
        ref={navigatorTriggerRef}
        type="button"
        aria-label={t("navigator.openLabel")}
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
