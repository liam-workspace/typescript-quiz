import type { JSX, RefObject } from "react"
import { useTranslation } from "react-i18next"
import {
  buildNavigatorGroups,
  type NavigatorCellStatus,
  type NavigatorSource,
  type SectionKind,
} from "../lib/navigator-state.js"
import { BottomSheet } from "./BottomSheet.js"

const STATUS_WORD_KEY = {
  current: "navigator.statusCurrent",
  answered: "navigator.statusAnswered",
  blank: "navigator.statusBlank",
  correct: "navigator.statusCorrect",
  incorrect: "navigator.statusIncorrect",
} as const satisfies Record<NavigatorCellStatus, string>

const REVIEW_MARK: Partial<Record<NavigatorCellStatus, string>> = {
  correct: "✓",
  incorrect: "✕",
  blank: "–",
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
  math: "library.section.math",
  other: "navigator.sectionOther",
}

export interface QuestionNavigatorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: NavigatorSource
  answeredCount: number
  totalCount: number
  onNavigate: (sectionId: string, questionId: string) => void
  returnFocusRef?: RefObject<HTMLElement | null>
}

export function QuestionNavigator({
  open,
  onOpenChange,
  source,
  answeredCount,
  totalCount,
  onNavigate,
  returnFocusRef,
}: QuestionNavigatorProps): JSX.Element {
  const { t } = useTranslation("runner")
  const groups = buildNavigatorGroups(source)
  const review = source.mode === "review"

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={review ? t("navigator.reviewTitle") : t("navigator.title")}
      closeLabel={t("navigator.closeLabel")}
      returnFocusRef={returnFocusRef}
    >
      <p className="m-reason" style={{ marginTop: 0 }}>
        {review
          ? t("navigator.reviewSubtitle")
          : t("navigator.progressSubtitle", {
              answered: answeredCount,
              total: totalCount,
            })}
      </p>
      <div className="question-panel-groups">
        {groups.map((group) => {
          const label = t(SECTION_LABEL_KEY[group.sectionType])
          const status = source.sections.find(
            (section) => section.id === group.sectionId,
          )?.status
          let heading = label

          if (!review && status === "closed") {
            heading = t("navigator.sectionFinished", { section: label })
          } else if (!review && status === "pending") {
            heading = t("navigator.sectionNotStarted", { section: label })
          }

          return (
            <section key={group.sectionId} className="question-group">
              <h3 id={`question-group-${group.sectionId}`}>{heading}</h3>
              <div
                role="group"
                aria-label={t("navigator.questionGridLabel", {
                  section: label,
                })}
                className="question-grid"
                style={{
                  gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))",
                }}
              >
                {group.cells.map((cell) => {
                  const word =
                    review && cell.status === "blank"
                      ? t("navigator.statusLeftBlank")
                      : t(STATUS_WORD_KEY[cell.status])

                  return (
                    <button
                      key={cell.questionId}
                      type="button"
                      disabled={cell.disabled}
                      aria-current={
                        cell.status === "current" ? "true" : undefined
                      }
                      aria-label={t("navigator.questionLabelWithStatus", {
                        ordinal: cell.ordinal,
                        status: word,
                      })}
                      data-status={cell.status}
                      className="np-cell"
                      onClick={() => {
                        onNavigate(group.sectionId, cell.questionId)
                      }}
                    >
                      {cell.ordinal}
                      {review ? (
                        <span className="np-mark" aria-hidden="true">
                          {REVIEW_MARK[cell.status]}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
      <ul aria-label={t("navigator.legendLabel")} className="question-legend">
        {(review
          ? (["correct", "incorrect", "blank"] as const)
          : (["answered", "current", "blank"] as const)
        ).map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span aria-hidden="true" data-status={status} className="np-key" />
            {t(LEGEND_LABEL_KEY[status])}
          </li>
        ))}
      </ul>
      {/* Prototype `sec.forward`: the note is about the section the child is
          in now, not any earlier forward-only one. */}
      {!review &&
      source.sections.some(
        (s) =>
          s.navigation === "forward_only" &&
          s.questions.some((q) => q.id === source.currentQuestionId),
      ) ? (
        <p className="question-panel-note">{t("navigator.forwardOnlyNote")}</p>
      ) : null}
    </BottomSheet>
  )
}
