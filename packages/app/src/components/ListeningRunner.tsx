import { useTranslation } from "react-i18next"
import type { RunnerQuestion, StimulusWire } from "../lib/api-types.js"
import { ChoiceList } from "./ChoiceList.js"
import { QuestionMedia } from "./QuestionMedia.js"

export interface QuestionPip {
  readonly questionId: string
  readonly ordinal: number
  readonly current: boolean
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
  // Defect B5: true once the server has TERMINALLY refused the CURRENT
  // question's queued answer (FlushController's per-item "rejected",
  // markTerminalRejection'd so it is never silently resent). The selection
  // stays shown -- see `selectedChoiceIds` -- but the child must be told it
  // did not actually save, honestly, rather than trusting an optimistic UI
  // the server has already disagreed with.
  readonly saveFailed: boolean
  readonly questionCount: number
  // One entry per question in the CURRENT section, in section order --
  // "the section's own question ordinals," not 1..questionCount. Read-only:
  // rendered as plain <span>s, no click handler, because a forward_only
  // section (openapi.yaml `PUT /attempts/{id}/position`, `409
  // navigation_locked` on a backward move) does not let a tap on an earlier
  // pip jump back to it.
  readonly pips: readonly QuestionPip[]
  readonly expired: ListeningExpiredState | null
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
  saveFailed,
  questionCount,
  pips,
  expired,
}: ListeningRunnerProps) {
  const { t } = useTranslation("runner")
  const currentPipIndex = pips.findIndex((pip) => pip.current)

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
    <div data-testid="listening-runner" className="runner-question">
      <div className="mb-3 flex items-center gap-3">
        <p className="question-count shrink-0">
          {t("runner.questionCount", {
            current: question.ordinal,
            total: questionCount,
          })}
        </p>
        <div className="flex flex-1 flex-wrap gap-1">
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
      </div>

      {stimulus ? (
        <>
          <QuestionMedia
            stimulus={stimulus}
            onClaimPlay={onClaimPlay}
            playing={audioSrc !== null}
          />
          {/* Defect A3: `mixed` means text AND media together, and its own
              `type` never says which -- only `mediaKind` does (mirrors
              QuestionMedia's own branch, and the review screen's
              showsImage/showsAudio). A `mixed` stimulus with
              `mediaKind: "audio"` claims a play exactly like a pure `audio`
              one (QuestionMedia renders the same Play button for both), so
              it must mount the SAME `<audio>` element to actually play the
              granted URL -- this used to only ever check
              `stimulus.type === "audio"`, so a mixed-audio claim spent a
              capped, irreplaceable play and nothing sounded. */}
          {(stimulus.type === "audio" ||
            (stimulus.type === "mixed" && stimulus.mediaKind === "audio")) &&
          audioSrc ? (
            <audio
              data-testid="audio-player"
              src={audioSrc}
              autoPlay
              onEnded={onAudioEnded}
              onError={onAudioError}
            />
          ) : null}
          {(stimulus.type === "audio" ||
            (stimulus.type === "mixed" && stimulus.mediaKind === "audio")) &&
          audioFailed ? (
            <p role="alert">
              {stimulus.maxPlays !== null &&
              stimulus.playsUsed >= stimulus.maxPlays
                ? t("listening.playbackFailed.noPlaysLeft")
                : t("listening.playbackFailed.retry")}
            </p>
          ) : null}
        </>
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
