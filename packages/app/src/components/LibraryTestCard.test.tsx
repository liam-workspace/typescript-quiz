import { cleanup, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import type { TestCard } from "../lib/api-types.js"
import { renderWithRouter } from "../test/renderWithRouter.js"
import { LibraryTestCard } from "./LibraryTestCard.js"

const fresh: TestCard = {
  id: "t3",
  slug: "practice-3",
  title: "Practice Test 3",
  level: "primary-step-1",
  durationSeconds: 1320,
  sections: [
    { type: "listening", questionCount: 4 },
    { type: "reading", questionCount: 4 },
  ],
  inProgressAttemptId: null,
  attemptCount: 0,
  bestAttempt: null,
}
const finished: TestCard = {
  ...fresh,
  attemptCount: 2,
  bestAttempt: {
    attemptId: "a2",
    submittedAt: "2026-11-18T17:05:00.000Z",
    pointsEarned: 7,
    pointsPossible: 8,
    percentage: 87.5,
  },
}
const running: TestCard = {
  ...fresh,
  inProgressAttemptId: "a9",
  attemptCount: 1,
}

const props = {
  highlighted: false,
  starting: false,
  disabledReason: null,
  onStart: vi.fn(),
}

describe("LibraryTestCard", () => {
  afterEach(() => {
    cleanup()
    props.onStart.mockReset()
  })

  it("names the article by its title and lists step, sections and minutes", () => {
    renderWithRouter(<LibraryTestCard {...props} test={fresh} />)

    const card = screen.getByRole("article", { name: "Practice Test 3" })

    expect(card).toHaveTextContent(
      "Step 1 · Listening 4 · Reading 4 · 22 minutes",
    )
  })

  it("starts a fresh test through onStart, as a button", async () => {
    const user = userEvent.setup()

    renderWithRouter(<LibraryTestCard {...props} test={fresh} />)
    await user.click(screen.getByRole("button", { name: "Start test" }))

    expect(props.onStart).toHaveBeenCalledWith(fresh)
  })

  it("offers See result (a link) and Try again for a finished test, with a Best chip", () => {
    renderWithRouter(<LibraryTestCard {...props} test={finished} />)

    expect(screen.getByRole("link", { name: "See result" })).toHaveAttribute(
      "href",
      "/attempts/a2/result",
    )
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled()
    expect(screen.getByText("Best 88%")).toBeInTheDocument()
  })

  it("offers only Continue (a link to the runner) and an In progress chip when running", () => {
    renderWithRouter(<LibraryTestCard {...props} test={running} highlighted />)

    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
      "href",
      "/attempts/a9/run",
    )
    expect(screen.queryByRole("button", { name: "Start test" })).toBeNull()
    expect(screen.getByText("In progress · Listening")).toBeInTheDocument()
  })

  it("disables Start with the reason attached when another test is running", () => {
    renderWithRouter(
      <LibraryTestCard
        {...props}
        test={fresh}
        disabledReason="Finish Practice Test 9 first."
      />,
    )

    const start = screen.getByRole("button", { name: "Start test" })

    expect(start).toBeDisabled()
    expect(start).toHaveAccessibleDescription("Finish Practice Test 9 first.")
  })

  it("shows a busy Start while starting and ignores further taps", () => {
    renderWithRouter(<LibraryTestCard {...props} test={fresh} starting />)

    const start = screen.getByRole("button", { name: "Starting…" })

    expect(start).toBeDisabled()
    expect(start).toHaveAttribute("aria-busy", "true")
  })

  it("renders extras (Part C download controls) below the actions", () => {
    renderWithRouter(
      <LibraryTestCard {...props} test={fresh} extras={<p>extras slot</p>} />,
    )

    expect(screen.getByText("extras slot")).toBeInTheDocument()
  })
})
