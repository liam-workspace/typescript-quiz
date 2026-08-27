import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import type { RunnerQuestion, StimulusWire } from "../lib/api-types.js"
import { ReadingRunner } from "./ReadingRunner.js"

// ReadingRunner is a presentational composition of QuestionMedia + ChoiceList,
// same discipline as ListeningRunner (see that file's test doc comment --
// components/ is stateless, frontend-lint's `stateless` rule rejects
// useState/useEffect anywhere under components/). All runner state lives one
// layer up in pages/attempts.$attemptId.run.tsx and is exercised end-to-end
// there. This file only proves the presentational contract.

const question: RunnerQuestion = {
  id: "q-r2",
  ordinal: 6,
  type: "single_choice",
  prompt: "Where does the fox live?",
  choices: [
    { id: "c-1", label: "A forest" },
    { id: "c-2", label: "A city" },
  ],
}

const otherQuestionInSameGroup: RunnerQuestion = {
  id: "q-r1",
  ordinal: 5,
  type: "single_choice",
  prompt: "What animal is in the story?",
  choices: [
    { id: "c-3", label: "A fox" },
    { id: "c-4", label: "A bear" },
  ],
}

const passage: StimulusWire = {
  id: "stim-1",
  type: "passage",
  bodyText: "Once there was a curious fox who lived at the edge of a forest.",
  maxPlays: null,
}

const pips = [
  { questionId: "q-r1", ordinal: 5, current: false },
  { questionId: "q-r2", ordinal: 6, current: true },
]

const baseProps = {
  question,
  onHandIn: vi.fn(),
  stimulus: passage,
  passageOrdinal: 1,
  passageFirstOrdinal: 5,
  passageLastOrdinal: 6,
  selectedChoiceIds: [],
  locked: false,
  onSelectChoice: vi.fn(),
  questionCount: 20,
  pips,
  hasPrevious: true,
  onPrevious: vi.fn(),
  hasNext: true,
  onNext: vi.fn(),
  expired: null,
}

describe("ReadingRunner", () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("renders the current question's prompt and choices", () => {
    render(<ReadingRunner {...baseProps} />)

    expect(screen.getByText("Where does the fox live?")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "A forest" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "A city" })).toBeInTheDocument()
  })

  it("renders the passage body text once per question group, shared across its questions", () => {
    const { rerender } = render(<ReadingRunner {...baseProps} />)

    expect(
      screen.getByText(
        "Once there was a curious fox who lived at the edge of a forest.",
      ),
    ).toBeInTheDocument()

    rerender(
      <ReadingRunner
        {...baseProps}
        question={otherQuestionInSameGroup}
        pips={[
          { questionId: "q-r1", ordinal: 5, current: true },
          { questionId: "q-r2", ordinal: 6, current: false },
        ]}
      />,
    )

    expect(
      screen.getByText(
        "Once there was a curious fox who lived at the edge of a forest.",
      ),
    ).toBeInTheDocument()
  })

  it("shows a Previous button, enabled, unlike the listening screen", () => {
    render(<ReadingRunner {...baseProps} />)

    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled()
  })

  it("forwards a Previous click to onPrevious, and hides Previous when hasPrevious is false", async () => {
    const onPrevious = vi.fn()
    const user = userEvent.setup()

    render(
      <ReadingRunner
        {...baseProps}
        onPrevious={onPrevious}
        hasPrevious={true}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Previous" }))

    expect(onPrevious).toHaveBeenCalledTimes(1)

    cleanup()

    render(<ReadingRunner {...baseProps} hasPrevious={false} />)

    expect(
      screen.queryByRole("button", { name: "Previous" }),
    ).not.toBeInTheDocument()
  })

  it("calls onNext when Next is clicked, and hides Next when hasNext is false", async () => {
    const onNext = vi.fn()
    const user = userEvent.setup()

    render(<ReadingRunner {...baseProps} onNext={onNext} hasNext={true} />)

    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(onNext).toHaveBeenCalledTimes(1)

    cleanup()

    render(<ReadingRunner {...baseProps} hasNext={false} />)

    expect(
      screen.queryByRole("button", { name: "Next" }),
    ).not.toBeInTheDocument()
  })

  it("allows changing an already-selected choice, unlike listening", async () => {
    const onSelectChoice = vi.fn()
    const user = userEvent.setup()

    render(
      <ReadingRunner
        {...baseProps}
        selectedChoiceIds={["c-1"]}
        locked={false}
        onSelectChoice={onSelectChoice}
      />,
    )

    expect(screen.getByRole("radio", { name: "A forest" })).toBeEnabled()

    await user.click(screen.getByRole("radio", { name: "A city" }))

    expect(onSelectChoice).toHaveBeenCalledExactlyOnceWith("c-2")
  })

  it("renders checkboxes instead of radios for a multi_choice question", () => {
    render(
      <ReadingRunner
        {...baseProps}
        question={{ ...question, type: "multi_choice" }}
        selectedChoiceIds={["c-1"]}
      />,
    )

    expect(screen.getAllByRole("checkbox")).toHaveLength(2)
    expect(screen.queryAllByRole("radio")).toHaveLength(0)
    expect(screen.getByRole("checkbox", { name: "A forest" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
  })

  it("calls onHandIn when Hand in is tapped", async () => {
    const onHandIn = vi.fn()

    render(<ReadingRunner {...baseProps} onHandIn={onHandIn} />)

    // Until plan 5 this button was deliberately disabled with a "not yet"
    // title -- an honest placeholder rather than a silent no-op. The dialog
    // now exists at /attempts/$attemptId/hand-in, so it navigates.
    await userEvent.click(screen.getByRole("button", { name: "Hand in" }))

    expect(onHandIn).toHaveBeenCalledTimes(1)
  })

  it("renders 'Passage N · questions X–Y' from the group's question ordinals", () => {
    render(
      <ReadingRunner
        {...baseProps}
        passageOrdinal={2}
        passageFirstOrdinal={7}
        passageLastOrdinal={8}
      />,
    )

    expect(screen.getByText("Passage 2 · questions 7–8")).toBeInTheDocument()
  })

  it("renders the pip/progress strip from questionCount and the passed-in ordinals, read-only", () => {
    render(<ReadingRunner {...baseProps} />)

    expect(screen.getByText("Question 6 of 20")).toBeInTheDocument()

    const strip = screen.getAllByTestId("question-pip")
    expect(strip.map((pip) => pip.textContent)).toEqual(["5", "6"])
    for (const pip of strip) {
      expect(pip.tagName).not.toBe("BUTTON")
    }
  })

  it("renders an actionable message instead of the question when expired is set to section", () => {
    render(
      <ReadingRunner
        {...baseProps}
        expired={{ kind: "section", resultUrl: null }}
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This section's time ran out.",
    )
    expect(
      screen.queryByText("Where does the fox live?"),
    ).not.toBeInTheDocument()
  })

  it("renders a result link when expired is set to attempt with a resultUrl", () => {
    render(
      <ReadingRunner
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
