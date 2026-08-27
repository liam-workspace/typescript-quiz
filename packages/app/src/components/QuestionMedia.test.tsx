import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { ApiError } from "../lib/api-client.js"
import type { CappedStimulusWire, OpenStimulusWire } from "../lib/api-types.js"
import { QuestionMedia } from "./QuestionMedia.js"

const cappedAudio: CappedStimulusWire = {
  id: "stim-audio",
  type: "audio",
  maxPlays: 2,
  playsUsed: 0,
  allowPause: false,
  allowSeek: false,
}

const openImage: OpenStimulusWire = {
  id: "stim-image",
  type: "image",
  maxPlays: null,
  mediaUrl: "/api/media/abc123.png?exp=1&sig=x",
}

const passage: OpenStimulusWire = {
  id: "stim-passage",
  type: "passage",
  maxPlays: null,
  bodyText: "Once upon a time...",
}

describe("QuestionMedia", () => {
  afterEach(() => {
    cleanup()
  })

  it("renders a passage's bodyText", () => {
    render(
      <QuestionMedia
        stimulus={passage}
        onClaimPlay={vi.fn()}
        playing={false}
      />,
    )

    expect(screen.getByText("Once upon a time...")).toBeInTheDocument()
  })

  it("renders an open image using the runner's mediaUrl verbatim", () => {
    const { container } = render(
      <QuestionMedia
        stimulus={openImage}
        onClaimPlay={vi.fn()}
        playing={false}
      />,
    )

    // Decorative (alt="") by design -- the stimulus is described elsewhere
    // in the question UI, so this intentionally drops out of the "img" ARIA
    // role and is queried by tag instead.
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/api/media/abc123.png?exp=1&sig=x",
    )
  })

  it("renders a play button for an audio stimulus and calls onClaimPlay on click", async () => {
    const onClaimPlay = vi.fn<() => Promise<void>>().mockResolvedValue()
    const user = userEvent.setup()

    render(
      <QuestionMedia
        stimulus={cappedAudio}
        onClaimPlay={onClaimPlay}
        playing={false}
      />,
    )

    const button = screen.getByRole("button", { name: "Play recording" })
    expect(button).toBeEnabled()

    await user.click(button)

    expect(onClaimPlay).toHaveBeenCalledTimes(1)
  })

  it("disables the play button while playing", () => {
    render(
      <QuestionMedia
        stimulus={cappedAudio}
        onClaimPlay={vi.fn()}
        playing={true}
      />,
    )

    expect(
      screen.getByRole("button", { name: "Play recording" }),
    ).toBeDisabled()
  })

  it("disables the play button once plays are exhausted", () => {
    render(
      <QuestionMedia
        stimulus={{ ...cappedAudio, playsUsed: 2 }}
        onClaimPlay={vi.fn()}
        playing={false}
      />,
    )

    expect(
      screen.getByRole("button", { name: "Play recording" }),
    ).toBeDisabled()
  })

  it("does not crash when onClaimPlay rejects with a 410 (an expired play or attempt)", async () => {
    const expired = new ApiError({
      type: "section_or_attempt_expired",
      title: "Expired",
      status: 410,
    })
    const onClaimPlay = vi.fn<() => Promise<void>>().mockRejectedValue(expired)
    const user = userEvent.setup()

    render(
      <QuestionMedia
        stimulus={cappedAudio}
        onClaimPlay={onClaimPlay}
        playing={false}
      />,
    )

    // If the component ever let this rejection go unhandled, vitest would
    // fail the test on the resulting unhandled-rejection warning.
    await user.click(screen.getByRole("button", { name: "Play recording" }))

    expect(onClaimPlay).toHaveBeenCalledTimes(1)
  })

  // `mixed` means text AND media together, and its own `type` never says
  // which media -- only `mediaKind` does (mirrors the review screen's
  // ReviewMixedStimulus). This used to fall through QuestionMedia's `return
  // null`, showing a child a blank panel for a real, publishable stimulus
  // type; see the "renders nothing for an unhandled stimulus type" test
  // this replaces, which had pinned that blank panel as correct.
  it("renders both the bodyText and the image for an open, image-backed mixed stimulus", () => {
    const openMixedImage: OpenStimulusWire = {
      id: "stim-mixed-image",
      type: "mixed",
      maxPlays: null,
      bodyText: "Look at the picture.",
      mediaUrl: "/api/media/mixed1.png?exp=1&sig=x",
      mediaKind: "image",
    }

    const { container } = render(
      <QuestionMedia
        stimulus={openMixedImage}
        onClaimPlay={vi.fn()}
        playing={false}
      />,
    )

    expect(screen.getByText("Look at the picture.")).toBeInTheDocument()
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/api/media/mixed1.png?exp=1&sig=x",
    )
  })

  it("renders both the bodyText and a play button for a capped, audio-backed mixed stimulus", async () => {
    const cappedMixedAudio: CappedStimulusWire = {
      id: "stim-mixed-audio",
      type: "mixed",
      maxPlays: 2,
      playsUsed: 0,
      allowPause: false,
      allowSeek: false,
      bodyText: "Listen and look.",
      mediaKind: "audio",
    }
    const onClaimPlay = vi.fn<() => Promise<void>>().mockResolvedValue()
    const user = userEvent.setup()

    render(
      <QuestionMedia
        stimulus={cappedMixedAudio}
        onClaimPlay={onClaimPlay}
        playing={false}
      />,
    )

    expect(screen.getByText("Listen and look.")).toBeInTheDocument()

    const button = screen.getByRole("button", { name: "Play recording" })
    expect(button).toBeEnabled()

    await user.click(button)

    expect(onClaimPlay).toHaveBeenCalledTimes(1)
  })

  it("never renders an image for a capped mixed stimulus, even if mediaKind is image", () => {
    const cappedMixedImage: CappedStimulusWire = {
      id: "stim-mixed-image-capped",
      type: "mixed",
      maxPlays: 1,
      playsUsed: 0,
      allowPause: false,
      allowSeek: false,
      bodyText: "Look at the picture.",
      mediaKind: "image",
    }

    const { container } = render(
      <QuestionMedia
        stimulus={cappedMixedImage}
        onClaimPlay={vi.fn()}
        playing={false}
      />,
    )

    // CappedStimulusWire structurally carries no mediaUrl at all -- this
    // pins that a capped mixed stimulus never leaks one into an <img>, the
    // same play-cap-bypass concern api-types.test.ts pins at the type level.
    expect(container.querySelector("img")).not.toBeInTheDocument()
    expect(screen.getByText("Look at the picture.")).toBeInTheDocument()
  })
})
