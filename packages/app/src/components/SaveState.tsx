import { useTranslation } from "react-i18next"
import { Icon, type IconName } from "./Icon.js"

export type SaveStateProps =
  | { readonly state: "saving" }
  | { readonly state: "saved" }
  | { readonly state: "failed" }
  | { readonly state: "pending"; readonly pendingCount: number }

const ICON: Record<SaveStateProps["state"], IconName> = {
  saved: "check",
  saving: "refresh",
  pending: "wifioff",
  failed: "alert",
}

export function SaveState(props: SaveStateProps) {
  const { t } = useTranslation("runner")
  const label =
    props.state === "pending"
      ? t("runner.saveState.pendingShort", { count: props.pendingCount })
      : t(`runner.saveState.${props.state}`)

  return (
    <span
      role="status"
      aria-live="polite"
      data-state={props.state}
      className="save-state m-save"
    >
      <Icon name={ICON[props.state]} small />
      {/* Its own element so the top bar can ellipsize (or, below 360 px,
          visually hide) it while it stays in the live region. */}
      <span className="m-save-text">{label}</span>
    </span>
  )
}
