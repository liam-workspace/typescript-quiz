import type { JSX } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./Icon.js"

export interface OfflineStorageItem {
  readonly slug: string
  readonly title: string
  readonly levelLabel: string
  readonly sizeMb: number
}

export interface OfflineStorageListProps {
  readonly items: readonly OfflineStorageItem[]
  readonly onRemove: (slug: string, title: string) => void
}

/** Prototype `vProfile()` "Saved for offline" list. */
export function OfflineStorageList({
  items,
  onRemove,
}: OfflineStorageListProps): JSX.Element {
  const { t } = useTranslation("runner")

  if (items.length === 0) {
    return (
      <div className="list">
        <div className="li">
          <div className="t">
            <small>{t("profile.offline.empty")}</small>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="list">
      {items.map((item) => (
        <div className="li" key={item.slug}>
          <span className="ticon">
            <Icon name="cloud" />
          </span>
          <div className="t">
            {item.title}
            <small>
              {t("profile.offline.item", {
                level: item.levelLabel,
                size: item.sizeMb,
              })}
            </small>
          </div>
          <button
            type="button"
            className="iconbtn"
            aria-label={t("profile.offline.remove", { title: item.title })}
            onClick={() => {
              onRemove(item.slug, item.title)
            }}
          >
            <Icon name="trash" />
          </button>
        </div>
      ))}
    </div>
  )
}
