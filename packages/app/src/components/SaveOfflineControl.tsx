import type { JSX } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./Icon.js"

export type SaveOfflineState =
  | { readonly kind: "none" }
  | { readonly kind: "saving"; readonly percent: number }
  | { readonly kind: "ready"; readonly stale: boolean }

export interface SaveOfflineControlProps {
  readonly title: string
  readonly sizeMb: number
  readonly state: SaveOfflineState
  readonly online: boolean
  readonly onSave: () => void
}

/** Prototype `testCard` download row: Save offline / Saving… N% / Available offline. */
export function SaveOfflineControl({
  title,
  sizeMb,
  state,
  online,
  onSave,
}: SaveOfflineControlProps): JSX.Element {
  const { t } = useTranslation("runner")

  if (state.kind === "saving") {
    return (
      <div className="m-actions">
        <span role="status" className="m-chip" data-tone="teal">
          {t("offline.saving", { percent: state.percent })}
        </span>
      </div>
    )
  }

  if (state.kind === "ready") {
    return (
      <div className="m-actions">
        <span className="m-chip" data-tone="good">
          <Icon name="check" small /> {t("offline.available")}
        </span>
        {state.stale ? (
          <button
            type="button"
            className="m-btn"
            data-variant="secondary"
            data-size="sm"
            disabled={!online}
            onClick={onSave}
          >
            {t("offline.updateSaved")}
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="m-actions">
      <button
        type="button"
        className="m-btn"
        data-variant="secondary"
        data-size="sm"
        aria-label={t("offline.saveLabel", { title })}
        disabled={!online}
        onClick={onSave}
      >
        <Icon name="download" small />{" "}
        {t("offline.save", { size: t("offline.sizeMb", { count: sizeMb }) })}
      </button>
    </div>
  )
}
