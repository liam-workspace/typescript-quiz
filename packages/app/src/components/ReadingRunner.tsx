import { useTranslation } from "react-i18next"
import type { RunnerQuestion, StimulusWire } from "../lib/api-types.js"
import { ChoiceList } from "./ChoiceList.js"
import type { QuestionPip } from "./ListeningRunner.js"
import { QuestionMedia } from "./QuestionMedia.js"

// Mirrors ListeningExpiredState (ListeningRunner.tsx) exactly -- see that
// file's doc comment for why a 410 reuses openapi.yaml's single
// `SectionOrAttemptExpired` shape rather than a screen-specific one. Reading
// has no claimPlay flow at all (its stimulus is always a passage, never
// audio), so the only way this ever becomes non-null here is a `PUT
// /position` 410 from Previous/Next -- the SAME condition, just reached
// through a different call than listening's.
export interface ReadingExpiredState {
  readonly kind: "section" | "attempt"
  readonly resultUrl: string | null
}

type QuestionPipState = "done" | "now" | "future"

function questionPipState(
  pip: QuestionPip,
  index: number,
  currentIndex: number,
): QuestionPipState {
  if (index < currentIndex) {
    return "done"
  }

  if (pip.current) {
    return "now"
  }

  return "future"
}

export interface ReadingRunnerProps {
  readonly question: RunnerQuestion
  readonly stimulus: StimulusWire | undefined
  // "Passage N" and its question range, from the CURRENT question's group --
  // 1-based position of the group within the section, and the ordinals of
  // the first/last question in that group. Computed by the page from
  // `section.groups`, not by this component.
  readonly passageOrdinal: number
  readonly passageFirstOrdinal: number
  readonly passageLastOrdinal: number
  // Every currently-selected choice id for the CURRENT question -- length 0
  // or 1 for a single_choice question, any length for multi_choice. See
  // ChoiceListProps.selectedIds.
  readonly selectedChoiceIds: readonly string[]
  // Computed by the page from envelope.responses and the section's
  // allowAnswerChange -- the exact same formula ListeningRunner's `locked`
  // uses. The seeded reading section always has allowAnswerChange: true, so
  // this evaluates to false in practice; it is a prop rather than a literal
  // `false` here so that fact stays data-driven, not hardcoded per screen.
  readonly locked: boolean
  readonly onSelectChoice: (choiceId: string) => void
  // Defect B5: mirrors ListeningRunner's own `saveFailed` -- see that
  // file's doc comment. True once the server has terminally refused the
  // CURRENT question's queued answer.
  readonly saveFailed: boolean
  readonly questionCount: number
  // Same read-only pip strip as ListeningRunner: one entry per question in
  // the CURRENT section, in section order, rendered as plain <span>s. A
  // `free` section allows backward navigation through the route-owned
  // Previous button, not by tapping an earlier pip.
  readonly pips: readonly QuestionPip[]
  readonly expired: ReadingExpiredState | null
}

// Purely presentational -- same discipline as ListeningRunner (components/
// is stateless by policy; frontend-lint's `stateless` rule rejects
// useState/useEffect anywhere under components/). All state (current
// question, in-flight responses, the expired state) lives in
// pages/attempts.$attemptId.run.tsx. Shares ChoiceList and QuestionMedia
// with ListeningRunner. Navigation controls live in the route's single
// semantic footer; this component only renders the current question body.
export function ReadingRunner({
  question,
  stimulus,
  passageOrdinal,
  passageFirstOrdinal,
  passageLastOrdinal,
  selectedChoiceIds,
  locked,
  onSelectChoice,
  saveFailed,
  questionCount,
  pips,
  expired,
}: ReadingRunnerProps) {
  const { t } = useTranslation("runner")
  const currentPipIndex = pips.findIndex((pip) => pip.current)

  if (expired) {
    return (
      <div data-testid="reading-runner">
        <p role="alert">
          {expired.kind === "attempt"
            ? t("sectionRules.expired.attemptMessage")
            : t("sectionRules.expired.sectionMessage")}
        </p>
        {expired.kind === "attempt" && expired.resultUrl ? (
          <a href={expired.resultUrl}>{t("sectionRules.expired.viewResult")}</a>
        ) : null}
      </div>
    )
  }

  return (
    <div data-testid="reading-runner" className="runner-question">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="question-count shrink-0">
          {t("runner.questionCount", {
            current: question.ordinal,
            total: questionCount,
          })}
        </p>
        <div className="flex min-w-20 flex-1 flex-wrap gap-1">
          {pips.map((pip, index) => (
            <span
              key={pip.questionId}
              data-testid="question-pip"
              data-state={questionPipState(pip, index, currentPipIndex)}
              aria-current={pip.current ? "step" : undefined}
              className="pip block overflow-hidden text-[0px]"
            >
              {pip.ordinal}
            </span>
          ))}
        </div>
        <p className="text-faint text-xs font-semibold">
          {t("reading.passageQuestions", {
            passageNumber: passageOrdinal,
            first: passageFirstOrdinal,
            last: passageLastOrdinal,
          })}
        </p>
      </div>

      {stimulus ? (
        <QuestionMedia
          stimulus={stimulus}
          onClaimPlay={() => Promise.resolve()}
          playing={false}
        />
      ) : null}

      <p className="question-prompt">{question.prompt}</p>
      <ChoiceList
        choices={question.choices}
        questionType={question.type}
        selectedIds={selectedChoiceIds}
        onSelect={onSelectChoice}
        locked={locked}
      />
      {saveFailed ? (
        <p
          role="alert"
          data-testid="save-failed-notice"
          className="bg-bad-bg text-bad border-bad/30 mt-3 rounded-lg border px-3.5 py-2.5 text-sm font-semibold"
        >
          {t("runner.saveFailed")}
        </p>
      ) : null}
    </div>
  )
}
