import { useTranslation } from "react-i18next"
import type { RunnerQuestion, StimulusWire } from "../lib/api-types.js"
import { ChoiceList } from "./ChoiceList.js"
import { QuestionMedia } from "./QuestionMedia.js"

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
  // 1-based position of this question within its section, and the
  // section's question count -- section-relative numbering (overall
  // progress lives in RunTopBar).
  readonly positionInSection: number
  readonly sectionQuestionCount: number
  // 0-1 playback fraction of the current clip, owned by the page.
  readonly audioProgress: number
  readonly onAudioProgress: (fraction: number) => void
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
  positionInSection,
  sectionQuestionCount,
  audioProgress,
  onAudioProgress,
  expired,
}: ListeningRunnerProps) {
  const { t } = useTranslation("runner")
  const playsUsed =
    stimulus !== undefined && "playsUsed" in stimulus ? stimulus.playsUsed : 0
  const hasAudio =
    stimulus !== undefined &&
    "playsUsed" in stimulus &&
    (stimulus.type === "audio" ||
      (stimulus.type === "mixed" && stimulus.mediaKind === "audio"))
  const playing = audioSrc !== null
  // Answers unlock once the recording has been played -- or has failed to
  // load, so a student is never stuck behind a clip that will not play.
  const heard = !hasAudio || audioFailed || (playsUsed > 0 && !playing)

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
      <p className="m-qmeta">
        {t("runner.sectionQuestionCount", {
          section: t("runner.sectionChip.listening"),
          current: positionInSection,
          total: sectionQuestionCount,
        })}
      </p>

      {stimulus ? (
        <>
          <QuestionMedia
            stimulus={stimulus}
            onClaimPlay={onClaimPlay}
            playing={playing}
            audioFailed={audioFailed}
            progress={audioProgress}
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
              onTimeUpdate={(event) => {
                const { currentTime, duration } = event.currentTarget

                if (duration > 0) {
                  onAudioProgress(currentTime / duration)
                }
              }}
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

      <h1 className="question-prompt" tabIndex={-1} data-qtitle>
        {question.prompt}
      </h1>
      <ChoiceList
        choices={question.choices}
        questionType={question.type}
        selectedIds={selectedChoiceIds}
        onSelect={onSelectChoice}
        locked={locked || !heard}
        lockedMessage={
          !locked && !heard ? t("listening.unlockHint") : undefined
        }
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
