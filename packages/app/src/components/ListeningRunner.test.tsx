import { cleanup, render, screen } from "@testing-library/react"
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
  selectedChoiceId: null,
  locked: false,
  onSelectChoice: vi.fn(),
  onClaimPlay: vi.fn<() => Promise<void>>().mockResolvedValue(),
  audioSrc: null,
  onAudioEnded: vi.fn(),
  questionCount: 20,
  pips,
  hasNext: true,
  onNext: vi.fn(),
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

  it("shows no Previous button", () => {
    render(<ListeningRunner {...baseProps} />)

    expect(
      screen.queryByRole("button", { name: "Previous" }),
    ).not.toBeInTheDocument()
  })

  it("calls onNext when Next is clicked, and hides Next when hasNext is false", async () => {
    const onNext = vi.fn()
    const user = userEvent.setup()

    render(<ListeningRunner {...baseProps} onNext={onNext} hasNext={true} />)

    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(onNext).toHaveBeenCalledTimes(1)

    cleanup()

    render(<ListeningRunner {...baseProps} hasNext={false} />)

    expect(
      screen.queryByRole("button", { name: "Next" }),
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
          resultUrl: "/api/attempts/attempt-1/result",
        }}
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your test time ran out. Your answers have been submitted.",
    )
    expect(screen.getByRole("link", { name: "View result" })).toHaveAttribute(
      "href",
      "/api/attempts/attempt-1/result",
    )
  })
})
