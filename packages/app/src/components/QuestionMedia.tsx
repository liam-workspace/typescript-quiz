import { useTranslation } from "react-i18next"
import type { StimulusWire } from "../lib/api-types.js"

export interface QuestionMediaProps {
  stimulus: StimulusWire
  onClaimPlay: () => Promise<void>
  playing: boolean
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
}: QuestionMediaProps) {
  const { t } = useTranslation("runner")

  if (stimulus.type === "passage") {
    return <div className="passage">{stimulus.bodyText}</div>
  }

  if (stimulus.type === "image" && stimulus.maxPlays === null) {
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
    const handlePlay = (): void => {
      onClaimPlay().catch(() => {
        // Handled by the caller -- see the component doc comment above.
      })
    }

    return (
      <div className="audio-box">
        <button
          type="button"
          className="h-11 min-w-11 touch-manipulation rounded-md border border-teal-700 bg-teal-50 px-4 text-sm font-bold text-teal-900 select-none disabled:cursor-not-allowed disabled:opacity-55"
          onClick={handlePlay}
          disabled={
            playing ||
            (stimulus.maxPlays !== null &&
              stimulus.playsUsed >= stimulus.maxPlays)
          }
        >
          {t("listening.playButton")}
        </button>
      </div>
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
    const handlePlay = (): void => {
      onClaimPlay().catch(() => {
        // Handled by the caller -- see the component doc comment above.
      })
    }

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
          <div className="audio-box mt-3">
            <button
              type="button"
              className="h-11 min-w-11 touch-manipulation rounded-md border border-teal-700 bg-teal-50 px-4 text-sm font-bold text-teal-900 select-none disabled:cursor-not-allowed disabled:opacity-55"
              onClick={handlePlay}
              disabled={
                playing ||
                (stimulus.maxPlays !== null &&
                  stimulus.playsUsed >= stimulus.maxPlays)
              }
            >
              {t("listening.playButton")}
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  return null
}
