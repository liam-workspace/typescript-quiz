import { useTranslation } from "react-i18next"
import type { RunnerQuestion, StimulusWire } from "../lib/api-types.js"
import { ChoiceList } from "./ChoiceList.js"
import { Icon } from "./Icon.js"
import { MathContent } from "./MathContent.js"
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
  readonly passageOrdinal: number | null
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
  // Names the section in the "<section> · Question N of M" line (math
  // shares this component with reading).
  readonly sectionType: "reading" | "math"
  readonly positionInSection: number
  readonly sectionQuestionCount: number
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
  sectionType,
  positionInSection,
  sectionQuestionCount,
  expired,
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

  const mediaElement = stimulus ? (
    <QuestionMedia
      stimulus={stimulus}
      onClaimPlay={() => Promise.resolve()}
      playing={false}
    />
  ) : null
  const media =
    stimulus && passageOrdinal !== null ? (
      <details
        key={question.id}
        className="m-passage"
        open={question.ordinal === passageFirstOrdinal}
      >
        <summary>
          <Icon name="book" />
          {t("reading.passageQuestions", {
            passageNumber: passageOrdinal,
            first: passageFirstOrdinal,
            last: passageLastOrdinal,
          })}
        </summary>
        {mediaElement}
      </details>
    ) : (
      mediaElement
    )

  return (
    <div data-testid="reading-runner" className="runner-question">
      <p className="m-qmeta">
        {t("runner.sectionQuestionCount", {
          section: t(`runner.sectionChip.${sectionType}`),
          current: positionInSection,
          total: sectionQuestionCount,
        })}
      </p>

      {media}

      <h1 className="question-prompt" tabIndex={-1} data-qtitle data-page-title>
        {question.promptBlocks?.length ? (
          <MathContent blocks={question.promptBlocks} />
        ) : (
          question.prompt
        )}
      </h1>
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
