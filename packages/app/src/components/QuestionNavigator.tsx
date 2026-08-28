import {
  DialogDescription,
  DialogTitle,
  Sheet,
  SheetContent,
} from "@liam-public/browser-react-ui"
import type { JSX } from "react"
import { useTranslation } from "react-i18next"
import {
  buildNavigatorGroups,
  type NavigatorCellStatus,
  type NavigatorSource,
  type SectionKind,
} from "../lib/navigator-state.js"

export interface QuestionNavigatorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: NavigatorSource
  answeredCount: number
  totalCount: number
  onNavigate: (sectionId: string, questionId: string) => void
}

/**
 * Which legend rows a mode shows. The SWATCH colours are not here -- they
 * come from `.np-key[data-status]` in src/index.css, the same rules that
 * colour the cells themselves, so a legend can never disagree with the grid
 * it explains.
 */
const LEGEND_LABEL_KEY = {
  answered: "navigator.legendAnswered",
  current: "navigator.legendCurrent",
  blank: "navigator.legendBlank",
  correct: "navigator.legendCorrect",
  incorrect: "navigator.legendIncorrect",
} as const satisfies Record<NavigatorCellStatus, string>

const SECTION_LABEL_KEY: Record<SectionKind, string> = {
  listening: "navigator.sectionListening",
  reading: "navigator.sectionReading",
  vocabulary: "navigator.sectionVocabulary",
  grammar: "navigator.sectionGrammar",
}

export function QuestionNavigator({
  open,
  onOpenChange,
  source,
  answeredCount,
  totalCount,
  onNavigate,
}: QuestionNavigatorProps): JSX.Element {
  const { t } = useTranslation("runner")
  const groups = buildNavigatorGroups(source)

  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-3">
        <DialogTitle>
          {source.mode === "review"
            ? t("navigator.reviewTitle")
            : t("navigator.title")}
        </DialogTitle>
        <DialogDescription>
          {source.mode === "review"
            ? t("navigator.reviewSubtitle")
            : t("navigator.progressSubtitle", {
                answered: answeredCount,
                total: totalCount,
              })}
        </DialogDescription>
        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          {groups.map((group) => (
            <div key={group.sectionId} className="mb-4">
              <div className="mb-2 text-[10.5px] font-extrabold tracking-wide uppercase">
                {t(SECTION_LABEL_KEY[group.sectionType])}
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {group.cells.map((cell) => (
                  <button
                    key={cell.questionId}
                    type="button"
                    disabled={cell.disabled}
                    aria-current={
                      cell.status === "current" ? "true" : undefined
                    }
                    aria-label={t("navigator.questionLabel", {
                      ordinal: cell.ordinal,
                    })}
                    data-status={cell.status}
                    className="np-cell size-11 text-sm"
                    onClick={() => {
                      onNavigate(group.sectionId, cell.questionId)
                    }}
                  >
                    {cell.ordinal}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/*
          The prototype carries a legend per mode (its NAV `keys` arrays:
          answered/current/blank while running, correct/incorrect/blank in
          review). Without it colour is the ONLY channel carrying a cell's
          meaning, which tells a colour-blind child nothing at all -- and
          the brief supplies these five strings precisely so it need not be.
        */}
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-stone-200 pt-2.5 text-xs text-stone-600">
          {(source.mode === "review"
            ? (["correct", "incorrect", "blank"] as const)
            : (["answered", "current", "blank"] as const)
          ).map((status) => (
            <li key={status} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                data-status={status}
                className="np-key shrink-0"
              />
              {t(LEGEND_LABEL_KEY[status])}
            </li>
          ))}
        </ul>
        {source.mode === "runner" &&
        source.sections.some((s) => s.navigation === "forward_only") ? (
          <p className="rounded-md bg-[var(--d-surface,theme(colors.slate.100))] p-2 text-xs">
            {t("navigator.forwardOnlyNote")}
          </p>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
