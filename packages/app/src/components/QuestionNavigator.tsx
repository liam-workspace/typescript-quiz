import { DialogDescription, DialogTitle } from "@liam-workspace/browser-react-ui"
import { useRef, type JSX, type RefObject } from "react"
import { useTranslation } from "react-i18next"
import {
  buildNavigatorGroups,
  type NavigatorCellStatus,
  type NavigatorSource,
  type SectionKind,
} from "../lib/navigator-state.js"
import { DeviceSheet } from "./DeviceSheet.js"

export interface QuestionNavigatorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: NavigatorSource
  answeredCount: number
  totalCount: number
  onNavigate: (sectionId: string, questionId: string) => void
  onOpenMenu?: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
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
  other: "navigator.sectionOther",
}

export function QuestionNavigator({
  open,
  onOpenChange,
  source,
  answeredCount,
  totalCount,
  onNavigate,
  onOpenMenu,
  returnFocusRef,
}: QuestionNavigatorProps): JSX.Element {
  const { t } = useTranslation("runner")
  const groups = buildNavigatorGroups(source)
  const switchingPanelRef = useRef(false)

  return (
    <DeviceSheet
      open={open}
      onOpenChange={onOpenChange}
      closeLabel={t("navigator.closeLabel")}
      side="right"
      className="question-panel"
      returnFocusRef={returnFocusRef}
      suppressReturnFocusRef={switchingPanelRef}
    >
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
      {onOpenMenu ? (
        <button
          type="button"
          className="question-panel-switch device-button w-full"
          data-variant="ghost"
          onClick={() => {
            switchingPanelRef.current = true
            onOpenMenu()
          }}
        >
          {t("menu.openLabel")}
        </button>
      ) : null}
      <div className="question-panel-groups">
        {groups.map((group) => (
          <section key={group.sectionId} className="question-group">
            <h3 id={`question-group-${group.sectionId}`}>
              {t(SECTION_LABEL_KEY[group.sectionType])}
            </h3>
            <div
              role="group"
              aria-label={t("navigator.questionGridLabel", {
                section: t(SECTION_LABEL_KEY[group.sectionType]),
              })}
              className="question-grid"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(44px, 1fr))",
              }}
            >
              {group.cells.map((cell) => (
                <button
                  key={cell.questionId}
                  type="button"
                  disabled={cell.disabled}
                  aria-current={cell.status === "current" ? "true" : undefined}
                  aria-label={t("navigator.questionLabel", {
                    ordinal: cell.ordinal,
                  })}
                  data-status={cell.status}
                  className="np-cell size-11 font-mono text-sm"
                  onClick={() => {
                    onNavigate(group.sectionId, cell.questionId)
                  }}
                >
                  {cell.ordinal}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      {/*
          The prototype carries a legend per mode (its NAV `keys` arrays:
          answered/current/blank while running, correct/incorrect/blank in
          review). Without it colour is the ONLY channel carrying a cell's
          meaning, which tells a colour-blind child nothing at all -- and
          the brief supplies these five strings precisely so it need not be.
        */}
      <ul aria-label={t("navigator.legendLabel")} className="question-legend">
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
        <p className="question-panel-note">{t("navigator.forwardOnlyNote")}</p>
      ) : null}
    </DeviceSheet>
  )
}
