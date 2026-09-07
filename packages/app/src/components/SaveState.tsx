import { useTranslation } from "react-i18next"

export type SaveStateProps =
  | { readonly state: "saving" }
  | { readonly state: "saved" }
  | { readonly state: "failed" }
  | { readonly state: "pending"; readonly pendingCount: number }

interface StateColors {
  readonly text: string
  readonly dot: string
}

function colorsFor(state: SaveStateProps["state"]): StateColors {
  switch (state) {
    case "saved":
      return { text: "text-good", dot: "bg-good" }

    case "failed":
      return { text: "text-bad", dot: "bg-bad" }

    default:
      return { text: "text-amber", dot: "bg-amber" }
  }
}

export function SaveState(props: SaveStateProps) {
  const { t } = useTranslation("runner")
  const label =
    props.state === "pending"
      ? t("runner.saveState.pending", { count: props.pendingCount })
      : t(`runner.saveState.${props.state}`)
  const colors = colorsFor(props.state)

  return (
    <span
      role="status"
      aria-live="polite"
      data-state={props.state}
      className={`save-state inline-flex items-center gap-1.5 text-xs font-bold ${colors.text}`}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${colors.dot}`}
      />
      {label}
    </span>
  )
}
