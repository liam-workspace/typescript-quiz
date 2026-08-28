import { Button } from "@liam-public/browser-react-ui"
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
  // `free` section allows backward navigation via the Previous button
  // below, not by tapping an earlier pip.
  readonly pips: readonly QuestionPip[]
  readonly hasPrevious: boolean
  readonly onPrevious: () => void
  readonly hasNext: boolean
  readonly onNext: () => void
  readonly expired: ReadingExpiredState | null
  // Supplied by the page, because navigation is state and `components/` is
  // stateless by policy. Present since plan 5 gave the hand-in dialog a
  // route; before that the button was deliberately inert.
  readonly onHandIn: () => void
}

// Purely presentational -- same discipline as ListeningRunner (components/
// is stateless by policy; frontend-lint's `stateless` rule rejects
// useState/useEffect anywhere under components/). All state (current
// question, in-flight responses, the expired state) lives in
// pages/attempts.$attemptId.run.tsx. Shares ChoiceList and QuestionMedia
// with ListeningRunner; the two things that actually differ for THIS
// section are navigation (a `free` section gets an enabled Previous button,
// unlike listening's forward_only) and answer-change (`locked` flows from
// the same allowAnswerChange formula rather than a second hardcoded rule).
// The Hand in button now navigates: plan 5 built the confirm dialog at
// /attempts/$attemptId/hand-in, so the honest "not yet" that used to sit
// here has been redeemed. It stays a callback rather than a link because
// `components/` is stateless and the page owns routing.
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
  hasPrevious,
  onPrevious,
  hasNext,
  onNext,
  expired,
  onHandIn,
}: ReadingRunnerProps) {
  const { t } = useTranslation("runner")

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
    <div data-testid="reading-runner">
      <p>
        {t("runner.questionCount", {
          current: question.ordinal,
          total: questionCount,
        })}
      </p>
      <div>
        {pips.map((pip) => (
          <span
            key={pip.questionId}
            data-testid="question-pip"
            aria-current={pip.current ? "step" : undefined}
          >
            {pip.ordinal}
          </span>
        ))}
      </div>

      <p>
        {t("reading.passageQuestions", {
          passageNumber: passageOrdinal,
          first: passageFirstOrdinal,
          last: passageLastOrdinal,
        })}
      </p>

      {stimulus ? (
        <QuestionMedia
          stimulus={stimulus}
          onClaimPlay={() => Promise.resolve()}
          playing={false}
        />
      ) : null}

      <p>{question.prompt}</p>
      <ChoiceList
        choices={question.choices}
        questionType={question.type}
        selectedIds={selectedChoiceIds}
        onSelect={onSelectChoice}
        locked={locked}
      />
      {saveFailed ? (
        <p role="alert" data-testid="save-failed-notice">
          {t("runner.saveFailed")}
        </p>
      ) : null}

      <div>
        {hasPrevious ? (
          <Button
            className="h-11 min-w-11 touch-manipulation select-none"
            onClick={onPrevious}
          >
            {t("runner.previous")}
          </Button>
        ) : null}
        {hasNext ? (
          <Button
            className="h-11 min-w-11 touch-manipulation select-none"
            onClick={onNext}
          >
            {t("runner.next")}
          </Button>
        ) : null}
        <Button
          className="h-11 min-w-11 touch-manipulation select-none"
          onClick={onHandIn}
        >
          {t("runner.handIn")}
        </Button>
      </div>
    </div>
  )
}
