import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NavigatorSource } from "../lib/navigator-state.js"
import { QuestionNavigator } from "./QuestionNavigator.js"

const i18n = i18next.createInstance()
await i18n.use(initReactI18next).init({
  lng: "en",
  resources: {
    en: {
      runner: {
        navigator: {
          title: "Questions",
          reviewTitle: "Jump to a question",
          progressSubtitle: "{{answered}} of {{total}} answered",
          reviewSubtitle: "Tap any question to see your answer",
          sectionListening: "Listening",
          sectionReading: "Reading",
          sectionVocabulary: "Vocabulary",
          sectionGrammar: "Grammar",
          sectionOther: "Other",
          questionLabel: "Question {{ordinal}}",
          legendAnswered: "Answered",
          legendCurrent: "You are here",
          legendBlank: "Not answered",
          legendCorrect: "Correct",
          legendIncorrect: "Wrong",
          questionGridLabel: "{{section}} questions",
          legendLabel: "Question status",
          forwardOnlyNote:
            "This section runs forward only. The navigator shows where you are but cannot move you.",
          openLabel: "Open the question navigator",
          closeLabel: "Close the question navigator",
          sectionFinished: "{{section}} · finished",
          sectionNotStarted: "{{section}} · not started",
          questionLabelWithStatus: "Question {{ordinal}}, {{status}}",
          statusCurrent: "you are here",
          statusAnswered: "answered",
          statusBlank: "not answered",
          statusLeftBlank: "left blank",
          statusCorrect: "correct",
          statusIncorrect: "wrong",
        },
      },
    },
    fr: {
      runner: {
        navigator: {
          title: "Questions",
          sectionListening: "Écoute",
          questionGridLabel: "Questions d’écoute",
          legendLabel: "État des questions",
          closeLabel: "Fermer le navigateur de questions",
        },
      },
    },
  },
})

beforeEach(async () => {
  await i18n.changeLanguage("en")
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderNavigator(source: NavigatorSource, onNavigate = vi.fn()) {
  render(
    <I18nextProvider i18n={i18n}>
      <QuestionNavigator
        open
        onOpenChange={vi.fn()}
        source={source}
        answeredCount={1}
        totalCount={3}
        onNavigate={onNavigate}
      />
    </I18nextProvider>,
  )

  return { onNavigate }
}

const forwardOnlySource: NavigatorSource = {
  mode: "runner",
  currentQuestionId: "q2",
  sections: [
    {
      id: "sec-listen",
      type: "listening",
      navigation: "forward_only",
      status: "open",
      questions: [
        { id: "q1", ordinal: 1 },
        { id: "q2", ordinal: 2 },
        { id: "q3", ordinal: 3 },
      ],
    },
  ],
  answeredQuestionIds: new Set(["q1"]),
}

// Two sections: Listening already finished (closed), Reading open with free
// navigation and its first question (ordinal 3) current.
const runnerSource: NavigatorSource = {
  mode: "runner",
  currentQuestionId: "r1",
  sections: [
    {
      id: "sec-listen",
      type: "listening",
      navigation: "forward_only",
      status: "closed",
      questions: [
        { id: "l1", ordinal: 1 },
        { id: "l2", ordinal: 2 },
      ],
    },
    {
      id: "sec-read",
      type: "reading",
      navigation: "free",
      status: "open",
      questions: [
        { id: "r1", ordinal: 3 },
        { id: "r2", ordinal: 4 },
      ],
    },
  ],
  answeredQuestionIds: new Set(["l1"]),
}

const reviewSource: NavigatorSource = {
  mode: "review",
  currentQuestionId: null,
  sections: [
    {
      id: "sec-read",
      type: "reading",
      navigation: "free",
      status: "closed",
      questions: [
        { id: "q1", ordinal: 1 },
        { id: "q2", ordinal: 2 },
        { id: "q3", ordinal: 3 },
      ],
    },
  ],
  answeredQuestionIds: new Set(["q1", "q2"]),
  outcomeByQuestionId: new Map([
    ["q1", "correct"],
    ["q2", "incorrect"],
    ["q3", "unanswered"],
  ]),
}

function renderWith(
  source: NavigatorSource,
  answeredCount: number,
  totalCount: number,
) {
  render(
    <I18nextProvider i18n={i18n}>
      <QuestionNavigator
        open
        onOpenChange={vi.fn()}
        source={source}
        answeredCount={answeredCount}
        totalCount={totalCount}
        onNavigate={vi.fn()}
      />
    </I18nextProvider>,
  )
}

describe("QuestionNavigator", () => {
  it("is a bottom sheet named Questions with the per-section answered count", () => {
    renderWith(runnerSource, 2, 4)

    expect(
      screen.getByRole("dialog", { name: "Questions" }),
    ).toBeInTheDocument()
    expect(screen.getByText("2 of 4 answered")).toBeInTheDocument()
  })

  it("labels each section with its progress state", () => {
    renderWith(runnerSource, 0, 4)

    expect(
      screen.getByRole("heading", { name: "Listening · finished" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Reading" })).toBeInTheDocument()
  })

  it("names a not-yet-started section as such", () => {
    renderWith(
      {
        ...runnerSource,
        currentQuestionId: "l1",
        sections: [
          { ...runnerSource.sections[0], status: "open" },
          { ...runnerSource.sections[1], status: "pending" },
        ],
      },
      0,
      2,
    )

    expect(
      screen.getByRole("heading", { name: "Reading · not started" }),
    ).toBeInTheDocument()
  })

  it("puts the status in words in every cell's accessible name", () => {
    renderWith(runnerSource, 1, 4)

    expect(
      screen.getByRole("button", { name: /^Question 1, answered$/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /^Question 3, you are here$/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /^Question 4, not answered$/ }),
    ).toBeInTheDocument()
  })

  it("explains forward-only navigation only while the current section is forward-only", () => {
    const note =
      "This section runs forward only. The navigator shows where you are but cannot move you."

    renderNavigator(forwardOnlySource)
    expect(screen.getByText(note)).toBeInTheDocument()

    cleanup()
    // A finished forward-only Listening section must not label the free
    // Reading section the child is in now.
    renderWith(runnerSource, 0, 2)
    expect(screen.queryByText(note)).not.toBeInTheDocument()
  })

  it("shows ✓ / ✕ / – marks beside review outcomes and names them in words", () => {
    renderWith(reviewSource, 2, 3)

    expect(screen.getByRole("button", { name: /correct$/ })).toHaveTextContent(
      "✓",
    )
    expect(screen.getByRole("button", { name: /wrong$/ })).toHaveTextContent(
      "✕",
    )
    expect(
      screen.getByRole("button", { name: /left blank$/ }),
    ).toHaveTextContent("–")
  })

  it("renders a dialog labelled by a visible title", () => {
    renderNavigator(forwardOnlySource)
    expect(
      screen.getByRole("dialog", { name: "Questions" }),
    ).toBeInTheDocument()
  })

  it("groups question grids and their legend in the prototype navigator panel", () => {
    renderNavigator(forwardOnlySource)

    expect(
      screen.getByRole("dialog", { name: "Questions" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("group", { name: "Listening questions" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("list", { name: "Question status" }),
    ).toBeInTheDocument()
  })

  it("renders inside the shared bottom sheet", () => {
    renderNavigator(forwardOnlySource)

    expect(screen.getByRole("dialog", { name: "Questions" })).toHaveClass(
      "bsheet",
    )
  })

  it("localizes question-grid and legend labels", async () => {
    await i18n.changeLanguage("fr")
    renderNavigator(forwardOnlySource)

    expect(
      screen.getByRole("group", { name: "Questions d’écoute" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("list", { name: "État des questions" }),
    ).toBeInTheDocument()
  })

  it("localizes the sheet close control", async () => {
    await i18n.changeLanguage("fr")
    renderNavigator(forwardOnlySource)

    expect(
      screen.getByRole("button", {
        name: "Fermer le navigateur de questions",
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument()
  })

  it("uses an auto-filling grid of 52px prototype cells", () => {
    renderNavigator(forwardOnlySource)

    const grid = screen.getByRole("group", { name: "Listening questions" })
    expect(grid).toHaveStyle({
      gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))",
    })
    expect(screen.getByRole("button", { name: /^Question 1,/ })).toHaveClass(
      "np-cell",
    )
  })

  it("disables every cell in a forward_only section", () => {
    renderNavigator(forwardOnlySource)
    const dialog = screen.getByRole("dialog")

    for (const ordinal of [1, 2, 3]) {
      expect(
        within(dialog).getByRole("button", {
          name: new RegExp(`^Question ${ordinal},`),
        }),
      ).toBeDisabled()
    }
  })

  it("does not call onNavigate when a disabled cell is clicked", async () => {
    const { onNavigate } = renderNavigator(forwardOnlySource)
    await userEvent.click(screen.getByRole("button", { name: /^Question 2,/ }))
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it("calls onNavigate with the section and question id when an enabled cell is clicked", async () => {
    const freeSource: NavigatorSource = {
      ...forwardOnlySource,
      sections: [{ ...forwardOnlySource.sections[0], navigation: "free" }],
    }
    const { onNavigate } = renderNavigator(freeSource)
    await userEvent.click(screen.getByRole("button", { name: /^Question 3,/ }))
    expect(onNavigate).toHaveBeenCalledWith("sec-listen", "q3")
  })

  // Review mode's whole job is colouring by outcome. The component records
  // each cell's status in `data-status`, but a data attribute nothing styles
  // is an outcome recorded and not shown -- a child would see a grid of
  // identical squares while every assertion on data-status passed. So this
  // asserts the rendered CLASSES differ, and that review disables nothing.
  it("colours review cells by outcome and leaves them all enabled", () => {
    renderNavigator({
      mode: "review",
      currentQuestionId: null,
      sections: [
        {
          id: "sec-read",
          type: "reading",
          navigation: "free",
          status: "closed",
          questions: [
            { id: "q1", ordinal: 1 },
            { id: "q2", ordinal: 2 },
            { id: "q3", ordinal: 3 },
          ],
        },
      ],
      answeredQuestionIds: new Set(["q1", "q2"]),
      outcomeByQuestionId: new Map([
        ["q1", "correct"],
        ["q2", "incorrect"],
        ["q3", "unanswered"],
      ]),
    })

    const correct = screen.getByRole("button", { name: /^Question 1,/ })
    const incorrect = screen.getByRole("button", { name: /^Question 2,/ })
    const blank = screen.getByRole("button", { name: /^Question 3,/ })

    // A closed section, yet review disables nothing -- the runner's rule
    // that a closed section refuses a position write does not apply here,
    // because review never writes a position.
    expect(correct).toBeEnabled()
    expect(incorrect).toBeEnabled()
    expect(blank).toBeEnabled()

    expect(correct).toHaveAttribute("data-status", "correct")
    expect(incorrect).toHaveAttribute("data-status", "incorrect")
    expect(blank).toHaveAttribute("data-status", "blank")

    // ...and each opts into the styled system, where `.np-cell[data-status]`
    // (src/index.css, ported from the prototype) gives the five states five
    // different looks. This used to compare className strings, which only
    // worked while the colours were inlined per cell; the states are now
    // distinguished by the data attribute asserted just above, and the
    // stylesheet keys on it. jsdom applies no CSS, so that the three
    // actually LOOK different is confirmed in the browser pass, not here.
    for (const cell of [correct, incorrect, blank]) {
      expect(cell).toHaveClass("np-cell")
    }
  })

  it("shows a runner legend of answered/current/blank, and a review legend of correct/incorrect/blank", () => {
    renderNavigator(forwardOnlySource)

    expect(screen.getByText("Answered")).toBeInTheDocument()
    expect(screen.getByText("You are here")).toBeInTheDocument()
    expect(screen.getByText("Not answered")).toBeInTheDocument()
    expect(screen.queryByText("Correct")).not.toBeInTheDocument()

    cleanup()

    renderNavigator({
      mode: "review",
      currentQuestionId: null,
      sections: [
        {
          id: "sec-read",
          type: "reading",
          navigation: "free",
          status: "closed",
          questions: [{ id: "q1", ordinal: 1 }],
        },
      ],
      answeredQuestionIds: new Set(["q1"]),
      outcomeByQuestionId: new Map([["q1", "correct"]]),
    })

    expect(screen.getByText("Correct")).toBeInTheDocument()
    expect(screen.getByText("Wrong")).toBeInTheDocument()
    expect(screen.getByText("Not answered")).toBeInTheDocument()
    expect(screen.queryByText("You are here")).not.toBeInTheDocument()
  })

  it("shows the progress subtitle with interpolated counts in runner mode", () => {
    renderNavigator(forwardOnlySource)
    expect(screen.getByText("1 of 3 answered")).toBeInTheDocument()
  })
})
