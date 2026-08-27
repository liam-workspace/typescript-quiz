import { Button } from "@liam-public/browser-react-ui"
import { useTranslation } from "react-i18next"
import type { RunnerQuestion, StimulusWire } from "../lib/api-types.js"
import { ChoiceList } from "./ChoiceList.js"
import { QuestionMedia } from "./QuestionMedia.js"

export interface QuestionPip {
  readonly questionId: string
  readonly ordinal: number
  readonly current: boolean
}

// A claimPlay 410 that outlived a section (or the whole attempt). Both are
// the SAME `SectionOrAttemptExpired` condition openapi.yaml already defines
// for every other runner call -- there is no distinct "media expired"
// problem type -- so this reuses the exact section/attempt-expired wording
// the rules screen already carries in every locale, rather than inventing a
// parallel message.
export interface ListeningExpiredState {
  readonly kind: "section" | "attempt"
  readonly resultUrl: string | null
}

export interface ListeningRunnerProps {
  readonly question: RunnerQuestion
  readonly stimulus: StimulusWire | undefined
  // Every currently-selected choice id for the CURRENT question -- length 0
  // or 1 for a single_choice question, any length for multi_choice. See
  // ChoiceListProps.selectedIds.
  readonly selectedChoiceIds: readonly string[]
  // See ChoiceListProps.locked -- computed by the page from
  // envelope.responses and the section's allowAnswerChange.
  readonly locked: boolean
  readonly onSelectChoice: (choiceId: string) => void
  readonly onClaimPlay: () => Promise<void>
  // Set only once a claimed play has resolved -- QuestionMedia never holds
  // or reconstructs this itself (see its own doc comment); the page sets it
  // from the PlayGrant it gets back from `claimPlay`.
  readonly audioSrc: string | null
  readonly onAudioEnded: () => void
  // The most recent claimed play's media stalled or failed to load (the
  // `<audio>` element's own `error` event, not a claim-time rejection --
  // QuestionMedia's own doc comment already covers those). The play was
  // already counted server-side by the time this fires (`POST /play`
  // resolves, incrementing `playsUsed`, before the browser ever starts
  // fetching bytes from the granted URL), so this is never used to pretend
  // the play was not spent -- only to tell the child honestly that the
  // recording did not come through, and whether tapping the button again
  // would even be able to help.
  readonly onAudioError: () => void
  readonly audioFailed: boolean
  readonly questionCount: number
  // One entry per question in the CURRENT section, in section order --
  // "the section's own question ordinals," not 1..questionCount. Read-only:
  // rendered as plain <span>s, no click handler, because a forward_only
  // section (openapi.yaml `PUT /attempts/{id}/position`, `409
  // navigation_locked` on a backward move) does not let a tap on an earlier
  // pip jump back to it.
  readonly pips: readonly QuestionPip[]
  readonly hasNext: boolean
  readonly onNext: () => void
  readonly expired: ListeningExpiredState | null
  // Supplied by the page -- navigation is state, and `components/` is
  // stateless by policy. A child must be able to hand in from either
  // section, not only the last one.
  readonly onHandIn: () => void
}

// Purely presentational -- see ListeningRunner.test.tsx's doc comment for
// why. All state (current question, in-flight responses, the claimed audio
// URL, the expired-audio state) lives in pages/attempts.$attemptId.run.tsx.
export function ListeningRunner({
  question,
  stimulus,
  selectedChoiceIds,
  locked,
  onSelectChoice,
  onClaimPlay,
  audioSrc,
  onAudioEnded,
  onAudioError,
  audioFailed,
  questionCount,
  pips,
  hasNext,
  onNext,
  onHandIn,
  expired,
}: ListeningRunnerProps) {
  const { t } = useTranslation("runner")

  if (expired) {
    return (
      <div data-testid="listening-runner">
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
    <div data-testid="listening-runner">
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

      {stimulus ? (
        <>
          <QuestionMedia
            stimulus={stimulus}
            onClaimPlay={onClaimPlay}
            playing={audioSrc !== null}
          />
          {stimulus.type === "audio" && audioSrc ? (
            <audio
              data-testid="audio-player"
              src={audioSrc}
              autoPlay
              onEnded={onAudioEnded}
              onError={onAudioError}
            />
          ) : null}
          {stimulus.type === "audio" && audioFailed ? (
            <p role="alert">
              {stimulus.maxPlays !== null &&
              stimulus.playsUsed >= stimulus.maxPlays
                ? t("listening.playbackFailed.noPlaysLeft")
                : t("listening.playbackFailed.retry")}
            </p>
          ) : null}
        </>
      ) : null}

      <p>{question.prompt}</p>
      <ChoiceList
        choices={question.choices}
        questionType={question.type}
        selectedIds={selectedChoiceIds}
        onSelect={onSelectChoice}
        locked={locked}
      />

      {/* No Previous button: this component is only ever rendered for a
          listening section, which spec section 1.4 requires to run
          forward_only. */}
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
  )
}
