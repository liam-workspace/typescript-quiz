import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import type {
  CappedStimulusWire,
  OpenStimulusWire,
  StimulusWire,
} from "../lib/api-types.js"
import { Icon } from "./Icon.js"

/**
 * The play card's hint ("You cannot pause or rewind." while playing). The
 * runner's Next button points at it while it is disabled mid-recording
 * (prototype `aria-describedby="plr"`).
 */
export const PLAY_HINT_ID = "play-hint"

export interface QuestionMediaProps {
  stimulus: StimulusWire
  onClaimPlay: () => Promise<void>
  playing: boolean
  // The most recent claimed play failed to load (see ListeningRunner).
  audioFailed?: boolean
  // 0-1 playback fraction for the progress bar.
  progress?: number
}

function AudioCard({
  stimulus,
  onClaimPlay,
  playing,
  audioFailed,
  progress,
  className,
}: {
  readonly stimulus: CappedStimulusWire | OpenStimulusWire
  readonly onClaimPlay: () => Promise<void>
  readonly playing: boolean
  readonly audioFailed: boolean
  readonly progress: number
  readonly className: string
}) {
  const { t } = useTranslation("runner")
  const { maxPlays } = stimulus
  const playsUsed = "playsUsed" in stimulus ? stimulus.playsUsed : 0
  const exhausted = maxPlays !== null && playsUsed >= maxPlays
  const left = maxPlays !== null ? Math.max(0, maxPlays - playsUsed) : null
  const spentAndClean = exhausted && !audioFailed && !playing
  let label = t("listening.playButton")
  let hint: string | null = null

  if (playing) {
    label = t("listening.playing")
    hint = t("listening.rule.noPauseRewind")
  } else if (audioFailed && exhausted) {
    label = t("listening.noPlaysLeft")
  } else if (spentAndClean) {
    label = t("listening.played")
    hint = t("listening.answerNow")
  } else if (!audioFailed && left !== null) {
    hint = t("listening.playsLeftHint", { count: left })
  }

  const handlePlay = (): void => {
    onClaimPlay().catch(() => {
      // Handled by the caller -- see QuestionMedia's doc comment.
    })
  }
  let leadingIcon: ReactNode = <Icon name="play" />

  if (playing) {
    leadingIcon = (
      <span className="m-eq" aria-hidden="true">
        <b />
        <b />
        <b />
      </span>
    )
  } else if (exhausted) {
    leadingIcon = null
  }

  const fraction = Math.min(1, Math.max(0, spentAndClean ? 1 : progress))

  return (
    <section aria-label={t("listening.recordingLabel")} className={className}>
      <button
        type="button"
        className="play-button"
        onClick={handlePlay}
        disabled={playing || exhausted}
        aria-describedby={hint ? PLAY_HINT_ID : undefined}
      >
        {leadingIcon}
        {label}
      </button>
      <div className="m-bar" aria-hidden="true">
        <i
          data-testid="audio-progress"
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
      {hint ? (
        <p id={PLAY_HINT_ID} className="m-reason" style={{ margin: 0 }}>
          {hint}
        </p>
      ) : null}
    </section>
  )
}

// Adapted from packages/web/src/components/QuestionMedia.tsx. The audio
// branch is rewritten from the ground up: no `controls`, no `autoPlay`, no
// seek bar. Native <audio controls> would let a student pause, rewind and
// replay -- exactly the behaviours spec §1.4 ("audio plays once, no pause or
// seek, forward-only navigation") forbids. Playback is driven entirely by
// the play button; there is no scrubber, and this component never sets or
// holds a mediaUrl for a capped stimulus -- `onClaimPlay` (owned by the
// caller) claims the play via `POST /play` and only then plays the granted,
// signed, short-lived URL.
//
// `components/` is stateless by policy (frontend-lint's layering rule: state
// moves up to the page), so a claim that comes back refused -- a 403/409/410,
// all ordinary runner outcomes here rather than bugs -- is the caller's state
// to hold, not this component's. `handlePlay` still swallows a rejection
// rather than leaving it unhandled, so a tap can never surface as an
// unhandled promise rejection regardless of how the caller's `onClaimPlay`
// behaves.
export function QuestionMedia({
  stimulus,
  onClaimPlay,
  playing,
  audioFailed = false,
  progress = 0,
}: QuestionMediaProps) {
  if (stimulus.type === "passage") {
    return <div className="passage">{stimulus.bodyText}</div>
  }

  if (stimulus.type === "image" && stimulus.maxPlays === null) {
    // Inline <svg> (a pictogram above the question -- see Choice.imageSvg
    // for why) takes priority: it is trusted content from the same import
    // pipeline as a choice's imageSvg, never from a student.
    if (stimulus.imageSvg) {
      return (
        <span
          aria-hidden="true"
          className="stimulus-image"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: stimulus.imageSvg }}
        />
      )
    }

    if (!stimulus.mediaUrl) {
      return null
    }

    return (
      <img
        src={stimulus.mediaUrl}
        alt=""
        className="max-h-60 w-auto rounded-md"
      />
    )
  }

  if (stimulus.type === "audio") {
    return (
      <AudioCard
        stimulus={stimulus}
        onClaimPlay={onClaimPlay}
        playing={playing}
        audioFailed={audioFailed}
        progress={progress}
        className="audio-box"
      />
    )
  }

  // `mixed` means text AND media together, and its OWN `type` never says
  // which media -- unlike the audio/image branches above, whose type IS the
  // discriminator. `mediaKind` (projected from media_asset.kind the same
  // way the review screen's ReviewMixedStimulus already does -- see
  // attempts.$attemptId.review.tsx's showsImage/showsAudio) is what this
  // branches on instead. This used to fall through to `return null`,
  // showing a child a blank panel for a real, publishable stimulus type.
  if (stimulus.type === "mixed") {
    // A capped stimulus carries no mediaUrl regardless of media kind (see
    // StimulusWire's doc comment) -- only an open one does.
    const mediaUrl = stimulus.maxPlays === null ? stimulus.mediaUrl : undefined

    return (
      <div className="mixed-stimulus">
        <div className="passage">{stimulus.bodyText}</div>
        {stimulus.mediaKind === "image" && mediaUrl ? (
          <img
            src={mediaUrl}
            alt=""
            className="mt-3 max-h-60 w-auto rounded-md"
          />
        ) : null}
        {stimulus.mediaKind === "audio" ? (
          <AudioCard
            stimulus={stimulus}
            onClaimPlay={onClaimPlay}
            playing={playing}
            audioFailed={audioFailed}
            progress={progress}
            className="audio-box mt-3"
          />
        ) : null}
      </div>
    )
  }

  return null
}
