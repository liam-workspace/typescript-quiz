import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import type { CappedStimulusWire, RunnerQuestion } from "../lib/api-types.js"
import { ListeningRunner } from "./ListeningRunner.js"

// ListeningRunner is a presentational composition of QuestionMedia +
// ChoiceList (components/ is stateless -- frontend-lint's `stateless` rule
// rejects useState/useEffect/etc. as AST nodes anywhere under components/,
// confirmed by probing the real scanner). All runner state (current
// question, in-flight responses, the claimed audio URL, the expired-audio
// state) lives one layer up, in the page
// (pages/attempts.$attemptId.run.tsx) and is exercised end-to-end there.
// This file only proves the presentational contract: given props, does it
// render the right thing and forward the right callbacks.

const question: RunnerQuestion = {
  id: "q-1",
  ordinal: 3,
  type: "single_choice",
  prompt: "What did the boy see?",
  choices: [
    { id: "c-1", label: "A dog" },
    { id: "c-2", label: "A cat" },
  ],
}

const cappedAudio: CappedStimulusWire = {
  id: "stim-1",
  type: "audio",
  maxPlays: 2,
  playsUsed: 0,
  allowPause: false,
  allowSeek: false,
}

const pips = [
  { questionId: "q-1", ordinal: 3, current: true },
  { questionId: "q-2", ordinal: 4, current: false },
]

const baseProps = {
  question,
  stimulus: cappedAudio,
  selectedChoiceIds: [],
  locked: false,
  onSelectChoice: vi.fn(),
  onClaimPlay: vi.fn<() => Promise<void>>().mockResolvedValue(),
  audioSrc: null,
  onAudioEnded: vi.fn(),
  onAudioError: vi.fn(),
  audioFailed: false,
  saveFailed: false,
  questionCount: 20,
  pips,
  expired: null,
}

describe("ListeningRunner", () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("renders the current question's prompt and choices", () => {
    render(<ListeningRunner {...baseProps} />)

    expect(screen.getByText("What did the boy see?")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "A dog" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "A cat" })).toBeInTheDocument()
  })

  it("forwards a choice click to onSelectChoice", async () => {
    const onSelectChoice = vi.fn()
    const user = userEvent.setup()

    render(<ListeningRunner {...baseProps} onSelectChoice={onSelectChoice} />)

    await user.click(screen.getByRole("radio", { name: "A cat" }))

    expect(onSelectChoice).toHaveBeenCalledExactlyOnceWith("c-2")
  })

  it("renders checkboxes instead of radios for a multi_choice question", () => {
    render(
      <ListeningRunner
        {...baseProps}
        question={{ ...question, type: "multi_choice" }}
        selectedChoiceIds={["c-1", "c-2"]}
      />,
    )

    expect(screen.getAllByRole("checkbox")).toHaveLength(2)
    expect(screen.queryAllByRole("radio")).toHaveLength(0)
    expect(screen.getByRole("checkbox", { name: "A dog" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    expect(screen.getByRole("checkbox", { name: "A cat" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
  })

  it("calls onClaimPlay when the play button is clicked", async () => {
    const onClaimPlay = vi.fn<() => Promise<void>>().mockResolvedValue()
    const user = userEvent.setup()

    render(<ListeningRunner {...baseProps} onClaimPlay={onClaimPlay} />)

    await user.click(screen.getByRole("button", { name: "Play recording" }))

    expect(onClaimPlay).toHaveBeenCalledTimes(1)
  })

  it("renders no audio element until audioSrc is set", () => {
    render(<ListeningRunner {...baseProps} audioSrc={null} />)

    expect(screen.queryByTestId("audio-player")).not.toBeInTheDocument()
  })

  it("renders the audio element with the granted src once audioSrc is set", () => {
    render(
      <ListeningRunner
        {...baseProps}
        audioSrc="/api/media/audio1.mp3?exp=1&sig=x"
      />,
    )

    expect(screen.getByTestId("audio-player")).toHaveAttribute(
      "src",
      "/api/media/audio1.mp3?exp=1&sig=x",
    )
  })

  // Defect A3: QuestionMedia renders a body and Play button for an
  // audio-backed `mixed` stimulus (its own test file covers that), but this
  // component only ever mounted the actual `<audio>` element for
  // `stimulus.type === "audio"` -- never `"mixed"` with `mediaKind ===
  // "audio"`. The claim (`POST /play`) still spent a capped, irreplaceable
  // play; the granted URL was stored; and nothing ever sounded. The blank
  // panel A3's first pass fixed became a dead button instead.
  it("mounts and plays the granted audio for a mixed (text + audio) stimulus, not just a pure-audio one", () => {
    render(
      <ListeningRunner
        {...baseProps}
        stimulus={{ ...cappedAudio, type: "mixed", mediaKind: "audio" }}
        audioSrc="/api/media/mixed1.mp3?exp=1&sig=x"
      />,
    )

    expect(screen.getByTestId("audio-player")).toHaveAttribute(
      "src",
      "/api/media/mixed1.mp3?exp=1&sig=x",
    )
  })

  it("tells the child about a failed load for a mixed (text + audio) stimulus too", () => {
    render(
      <ListeningRunner
        {...baseProps}
        stimulus={{ ...cappedAudio, type: "mixed", mediaKind: "audio" }}
        audioSrc={null}
        audioFailed
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "tap Play recording to try again",
    )
  })

  // Defect fix: the `<audio>` element previously had no `onError` at all,
  // so a stalled or failed load left the page with no way to hear about it
  // and the play button stuck disabled forever (see run.tsx's `PlayState`
  // "failed" variant doc comment). This only proves the presentational
  // half: the element forwards its native `error` event to the page's
  // callback, and an honest message renders once the page says the last
  // play failed -- state ownership (resetting `playing`, deciding when to
  // show `audioFailed`) is the page's, exercised in run.test.tsx.
  it("forwards the audio element's error event to onAudioError", () => {
    const onAudioError = vi.fn()

    render(
      <ListeningRunner
        {...baseProps}
        audioSrc="/api/media/audio1.mp3?exp=1&sig=x"
        onAudioError={onAudioError}
      />,
    )

    fireEvent.error(screen.getByTestId("audio-player"))

    expect(onAudioError).toHaveBeenCalledTimes(1)
  })

  it("shows nothing about a failed play until the page says one failed", () => {
    render(<ListeningRunner {...baseProps} audioFailed={false} />)

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  // Defect B5: a terminal per-item rejection used to reach the page and be
  // thrown away silently -- the selection stayed on screen, optimistic, with
  // nothing telling the child the server had actually refused it.
  it("shows nothing about a save failure until the page says one happened", () => {
    render(<ListeningRunner {...baseProps} saveFailed={false} />)

    expect(screen.queryByTestId("save-failed-notice")).not.toBeInTheDocument()
  })

  it("tells the child their answer did not save when the page reports a terminal rejection", () => {
    render(<ListeningRunner {...baseProps} saveFailed />)

    expect(screen.getByTestId("save-failed-notice")).toHaveAttribute(
      "role",
      "alert",
    )
    expect(screen.getByTestId("save-failed-notice")).toHaveTextContent(
      "didn't save",
    )
  })

  it("tells the child their play was used and offers a retry when plays remain", () => {
    render(
      <ListeningRunner
        {...baseProps}
        stimulus={{ ...cappedAudio, maxPlays: 2, playsUsed: 1 }}
        audioSrc={null}
        audioFailed
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "That play has been used",
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "tap Play recording to try again",
    )
  })

  // The dishonest failure mode this exists to prevent: telling a child to
  // "try again" when the play button is about to be disabled anyway
  // because every play is already spent.
  it("does not invite a retry once every play for this stimulus is spent", () => {
    render(
      <ListeningRunner
        {...baseProps}
        stimulus={{ ...cappedAudio, maxPlays: 2, playsUsed: 2 }}
        audioSrc={null}
        audioFailed
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "no plays left for this question",
    )
    expect(screen.getByRole("alert")).not.toHaveTextContent("try again")
  })

  it("re-enables the play button once the failed play's element is gone", () => {
    render(
      <ListeningRunner
        {...baseProps}
        stimulus={{ ...cappedAudio, maxPlays: 2, playsUsed: 1 }}
        audioSrc={null}
        audioFailed
      />,
    )

    expect(screen.getByRole("button", { name: "Play recording" })).toBeEnabled()
  })

  it("shows no Previous button", () => {
    render(<ListeningRunner {...baseProps} />)

    expect(
      screen.queryByRole("button", { name: "Previous" }),
    ).not.toBeInTheDocument()
  })

  it("renders the pip/progress strip from questionCount and the passed-in ordinals, read-only", () => {
    render(<ListeningRunner {...baseProps} />)

    expect(screen.getByText("Question 3 of 20")).toBeInTheDocument()

    const strip = screen.getAllByTestId("question-pip")
    expect(strip.map((pip) => pip.textContent)).toEqual(["3", "4"])
    for (const pip of strip) {
      expect(pip.tagName).not.toBe("BUTTON")
    }
  })

  it("uses the prototype body classes and marks prior, current, and future pips", () => {
    render(
      <ListeningRunner
        {...baseProps}
        pips={[
          { questionId: "q-0", ordinal: 2, current: false },
          { questionId: "q-1", ordinal: 3, current: true },
          { questionId: "q-2", ordinal: 4, current: false },
        ]}
      />,
    )

    expect(screen.getByText("Question 3 of 20")).toHaveClass("question-count")
    expect(screen.getByText("What did the boy see?")).toHaveClass(
      "question-prompt",
    )
    expect(screen.getByRole("radiogroup")).toHaveClass("choice-stack")
    expect(
      screen.getAllByTestId("question-pip").map((pip) => pip.dataset.state),
    ).toEqual(["done", "now", "future"])
    expect(
      screen.queryByRole("button", { name: /previous|next|hand in/i }),
    ).not.toBeInTheDocument()
  })

  it("renders an actionable message instead of the question when expired is set to section", () => {
    render(
      <ListeningRunner
        {...baseProps}
        expired={{ kind: "section", resultUrl: null }}
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This section's time ran out.",
    )
    expect(screen.queryByText("What did the boy see?")).not.toBeInTheDocument()
  })

  it("renders a result link when expired is set to attempt with a resultUrl", () => {
    render(
      <ListeningRunner
        {...baseProps}
        expired={{
          kind: "attempt",
          resultUrl: "/attempts/attempt-1/result",
        }}
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your test time ran out. Your answers have been submitted.",
    )
    expect(screen.getByRole("link", { name: "View result" })).toHaveAttribute(
      "href",
      "/attempts/attempt-1/result",
    )
  })
})
