import { useTranslation } from "react-i18next"
import type { LibraryFilterValue } from "../lib/library-state.js"

const CHOICES: readonly LibraryFilterValue[] = ["all", "todo", "done"]

export interface LibraryFilterProps {
  readonly value: LibraryFilterValue
  readonly onChange: (value: LibraryFilterValue) => void
}

export function LibraryFilter({ value, onChange }: LibraryFilterProps) {
  const { t } = useTranslation("runner")

  return (
    <div role="group" aria-label={t("library.filter.label")} className="m-seg">
      {CHOICES.map((choice) => (
        <button
          key={choice}
          type="button"
          aria-pressed={value === choice}
          onClick={() => {
            onChange(choice)
          }}
        >
          {t(`library.filter.${choice}`)}
        </button>
      ))}
    </div>
  )
}
