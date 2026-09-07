import { cleanup, render, screen, within } from "@testing-library/react"
import { isRedirect } from "@tanstack/react-router"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import i18n from "../i18n.js"
import { ApiError } from "../lib/api-client.js"
import type { ReviewPayload } from "../lib/api-types.js"
import {
  ReviewRouteError,
  ReviewScreen,
  loadReview,
} from "./attempts.$attemptId.review.js"

const reviewPayload: ReviewPayload = {
  attemptId: "attempt-1",
  items: [
    {
      questionId: "question-7",
      ordinal: 7,
      sectionId: "section-listening",
      sectionType: "listening",
      prompt: "What does the boy want to do?",
      outcome: "correct",
      stimulus: {
        id: "stimulus-7",
        type: "audio",
        title: "A conversation",
        mediaUrl: "/media/audio/l07.mp3?exp=1787932800&sig=signed-review-url",
        replayable: true,
      },
      choices: [
        {
          id: "choice-7-a",
          label: "Visit his friend",
          isCorrect: false,
          selected: false,
        },
        {
          id: "choice-7-b",
          label: "Read a book",
          isCorrect: true,
          selected: true,
        },
        {
          id: "choice-7-c",
          label: "Play football",
          isCorrect: false,
          selected: false,
        },
      ],
    },
    {
      questionId: "question-12",
      ordinal: 12,
      sectionId: "section-reading",
      sectionType: "reading",
      prompt: "Where are the children going?",
      outcome: "unanswered",
      stimulus: {
        id: "stimulus-12",
        type: "passage",
        title: "A day out",
        bodyText: "The children packed their books and walked into town.",
        replayable: true,
      },
      choices: [
        {
          id: "choice-12-a",
          label: "To the park",
          isCorrect: false,
          selected: false,
        },
        {
          id: "choice-12-b",
          label: "To the library",
          isCorrect: true,
          selected: false,
        },
        {
          id: "choice-12-c",
          label: "To the shop",
          isCorrect: false,
          selected: false,
        },
      ],
    },
    {
      questionId: "question-27",
      ordinal: 27,
      sectionId: "section-reading",
      sectionType: "reading",
      prompt: "Why did Mia take an umbrella?",
      outcome: "incorrect",
      choices: [
        {
          id: "choice-27-a",
          label: "It was sunny",
          isCorrect: false,
          selected: true,
        },
        {
          id: "choice-27-b",
          label: "It might rain",
          isCorrect: true,
          selected: false,
        },
      ],
    },
  ],
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type":
        status >= 400 ? "application/problem+json" : "application/json",
    },
  })
}

function mixedReview(mediaKind: "audio" | "image"): ReviewPayload {
  return {
    attemptId: "attempt-1",
    items: [
      {
        questionId: "question-9",
        ordinal: 9,
        sectionId: "section-listening",
        sectionType: "listening",
        prompt: "What is happening?",
        outcome: "correct",
        stimulus: {
          id: "stimulus-9",
          type: "mixed",
          title: "At the park",
          bodyText: "Look and listen.",
          mediaUrl: "/media/mixed/m01.bin?exp=1787932800&sig=signed-review-url",
          mediaKind,
          replayable: true,
        },
        choices: [
          {
            id: "choice-9-a",
            label: "A game",
            isCorrect: true,
            selected: true,
          },
          {
            id: "choice-9-b",
            label: "A meal",
            isCorrect: false,
            selected: false,
          },
        ],
      },
    ],
  }
}

describe("attempt review page", () => {
  afterEach(async () => {
    cleanup()
    vi.unstubAllGlobals()
    await i18n.changeLanguage("en")
  })

  // The screen used to derive this chip from a section's POSITION in the
  // item list -- first section seen means listening, anything else means
  // reading. That holds for a two-section test in the expected order and
  // nothing else, and the section-type enum has four values. Here the
  // FIRST item is a reading question, so a position guess says "Listening"
  // and the carried value says "Reading".
  it("labels the section from the type the server sends, not from item order", () => {
    render(
      <ReviewScreen
        review={{
          attemptId: "attempt-1",
          items: [
            {
              ...reviewPayload.items[1],
              sectionId: "section-reading",
              sectionType: "reading",
            },
          ],
        }}
      />,
    )

    expect(screen.getByText("Reading")).toBeInTheDocument()
    expect(screen.queryByText("Listening")).not.toBeInTheDocument()
  })

  it("uses a neutral section for a legacy review response with no reliable type", async () => {
    const { sectionType: _sectionType, ...legacyItem } = reviewPayload.items[0]
    const user = userEvent.setup()

    render(
      <ReviewScreen
        review={{
          attemptId: "attempt-1",
          items: [legacyItem as ReviewPayload["items"][number]],
        }}
      />,
    )

    expect(
      screen.getByText("Other", { selector: "[data-section-type]" }),
    ).toHaveAttribute("data-section-type", "other")
    expect(
      screen.queryByText("RUNNER.SECTIONCHIP.UNDEFINED"),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Jump to a question" }))

    const navigator = screen.getByRole("dialog", {
      name: "Jump to a question",
    })
    expect(
      within(navigator).getByRole("heading", {
        level: 3,
        name: "Other",
      }),
    ).toBeInTheDocument()
    expect(navigator).not.toHaveTextContent(/undefined/iu)
    expect(navigator).not.toHaveTextContent(/runner\./iu)
  })

  it("uses a known sibling type for a legacy item in the same section", async () => {
    const { sectionType: _sectionType, ...legacyItem } = reviewPayload.items[2]
    const user = userEvent.setup()

    render(
      <ReviewScreen
        review={{
          attemptId: "attempt-1",
          items: [
            legacyItem as ReviewPayload["items"][number],
            {
              ...reviewPayload.items[2],
              questionId: "question-28",
              ordinal: 28,
              sectionType: "grammar",
            },
          ],
        }}
      />,
    )

    expect(
      screen.getByText("Grammar", { selector: "[data-section-type]" }),
    ).toHaveAttribute("data-section-type", "grammar")

    await user.click(screen.getByRole("button", { name: "Jump to a question" }))
    expect(
      within(screen.getByRole("dialog")).getByRole("heading", {
        level: 3,
        name: "Grammar",
      }),
    ).toBeInTheDocument()
  })

  it("renders the vocabulary type from the review contract", () => {
    render(
      <ReviewScreen
        review={{
          attemptId: "attempt-1",
          items: [{ ...reviewPayload.items[2], sectionType: "vocabulary" }],
        }}
      />,
    )

    expect(
      screen.getByText("Vocabulary", { selector: "[data-section-type]" }),
    ).toHaveAttribute("data-section-type", "vocabulary")
  })

  it("renders the grammar type from the review contract", () => {
    render(
      <ReviewScreen
        review={{
          attemptId: "attempt-1",
          items: [{ ...reviewPayload.items[2], sectionType: "grammar" }],
        }}
      />,
    )

    expect(
      screen.getByText("Grammar", { selector: "[data-section-type]" }),
    ).toHaveAttribute("data-section-type", "grammar")
  })

  it("compacts and wraps the review app bar for a long French section label", async () => {
    await i18n.changeLanguage("fr")
    render(<ReviewScreen review={reviewPayload} />)

    expect(screen.getByRole("banner")).toHaveClass(
      "flex-wrap",
      "sm:flex-nowrap",
    )
    expect(
      screen.getByText("Compréhension orale", {
        selector: "[data-section-type]",
      }),
    ).toHaveClass("min-w-0", "max-w-full")
    expect(screen.getByText("1 sur 3")).toHaveClass("ml-auto", "shrink-0")
  })

  it("uses the prototype review shell, semantic verdicts, and navigator", async () => {
    const user = userEvent.setup()
    render(<ReviewScreen review={reviewPayload} />)

    expect(screen.getByRole("banner")).toHaveClass("app-bar")
    expect(screen.getByRole("main")).toHaveClass("device-main")
    expect(screen.getByRole("contentinfo")).toHaveClass("device-footer")
    expect(
      screen.getByText("Listening", { selector: "[data-section-type]" }),
    ).toHaveAttribute("data-section-type", "listening")
    expect(screen.getByText("Question 7")).toHaveClass("question-count")
    expect(screen.getByText("Correct")).toHaveAttribute(
      "data-verdict",
      "correct",
    )
    expect(screen.getByText(/your answer/i).closest("li")).toHaveClass("choice")
    expect(screen.getByText(/your answer/i).closest("li")).toHaveAttribute(
      "data-verdict",
      "correct",
    )

    const navigatorTrigger = screen.getByRole("button", {
      name: "Jump to a question",
    })
    expect(navigatorTrigger).toHaveAttribute("aria-expanded", "false")
    await user.click(navigatorTrigger)
    expect(
      screen.getByRole("dialog", { name: "Jump to a question" }),
    ).toHaveClass("question-panel")
    expect(screen.queryByRole("main")).not.toBeInTheDocument()

    await user.keyboard("{Escape}")
    expect(navigatorTrigger).toHaveFocus()

    await user.click(navigatorTrigger)
    await user.click(
      screen.getByRole("button", { name: "Close the question navigator" }),
    )
    expect(navigatorTrigger).toHaveFocus()

    expect(screen.getByRole("link", { name: "← Back to result" })).toHaveClass(
      "device-button",
    )
    expect(screen.getByRole("button", { name: "Previous" })).toHaveClass(
      "device-button",
    )
    expect(screen.getByRole("button", { name: "Next" })).toHaveClass(
      "device-button",
    )
  })

  it("shows a selected correct choice as the student's correct answer", () => {
    render(<ReviewScreen review={reviewPayload} />)

    expect(
      screen.getByText("What does the boy want to do?"),
    ).toBeInTheDocument()
    expect(screen.getByText("Correct")).toBeInTheDocument()
    expect(screen.getByText("Your answer · correct")).toBeInTheDocument()
    expect(
      screen.queryByText("Your answer · incorrect"),
    ).not.toBeInTheDocument()
  })

  it("shows a selected incorrect choice separately from the correct answer", async () => {
    const user = userEvent.setup()
    render(<ReviewScreen review={reviewPayload} />)

    await user.click(screen.getByRole("button", { name: "Jump to a question" }))
    await user.click(screen.getByRole("button", { name: "Question 27" }))

    expect(
      screen.getByText("Why did Mia take an umbrella?"),
    ).toBeInTheDocument()
    expect(screen.getByText("Your answer · incorrect")).toBeInTheDocument()
    expect(
      screen.getByText("Your answer · incorrect").closest("li"),
    ).toHaveAttribute("data-verdict", "incorrect")
    expect(screen.getByText("Correct answer")).toBeInTheDocument()
    expect(screen.queryByText("Your answer · correct")).not.toBeInTheDocument()
  })

  it("shows every choice as unselected and a left-blank notice for an unanswered question", async () => {
    const user = userEvent.setup()
    render(<ReviewScreen review={reviewPayload} />)

    await user.click(screen.getByRole("button", { name: "Jump to a question" }))
    await user.click(screen.getByRole("button", { name: "Question 12" }))

    const choices = screen.getByRole("list", { name: "Answer choices" })
    expect(within(choices).getAllByRole("listitem")).toHaveLength(3)
    expect(within(choices).queryByText(/Your answer/)).not.toBeInTheDocument()
    expect(screen.getByText("Question 12 was left blank.")).toBeInTheDocument()
    expect(screen.getByText("Correct answer")).toBeInTheDocument()
  })

  it("renders the signed replay URL for media and no replay control for a passage-only stimulus", async () => {
    const user = userEvent.setup()
    render(<ReviewScreen review={reviewPayload} />)

    expect(screen.getByLabelText("Replay audio")).toHaveAttribute(
      "src",
      "/media/audio/l07.mp3?exp=1787932800&sig=signed-review-url",
    )

    await user.click(screen.getByRole("button", { name: "Jump to a question" }))
    await user.click(screen.getByRole("button", { name: "Question 12" }))

    expect(screen.queryByLabelText("Replay audio")).not.toBeInTheDocument()
    expect(screen.getByText("A day out")).toBeInTheDocument()
    expect(
      screen.getByText("The children packed their books and walked into town."),
    ).toBeInTheDocument()
  })

  // `mixed` means text PLUS media and never says which media -- only
  // `mediaKind` does. Branching on `type` alone rendered EVERY mixed
  // stimulus as an audio player, so a mixed passage-and-picture question
  // showed a child a dead audio control and no image. Both directions,
  // because either one alone passes against a hardwired branch.
  it("renders an audio control for a mixed stimulus whose mediaKind is audio", () => {
    render(<ReviewScreen review={mixedReview("audio")} />)

    expect(screen.getByLabelText("Replay audio")).toHaveAttribute(
      "src",
      "/media/mixed/m01.bin?exp=1787932800&sig=signed-review-url",
    )
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.getByText("Look and listen.")).toBeInTheDocument()
  })

  it("renders an image for a mixed stimulus whose mediaKind is image", () => {
    render(<ReviewScreen review={mixedReview("image")} />)

    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/media/mixed/m01.bin?exp=1787932800&sig=signed-review-url",
    )
    expect(screen.queryByLabelText("Replay audio")).not.toBeInTheDocument()
    expect(screen.getByText("Look and listen.")).toBeInTheDocument()
  })

  it("renders a picture choice's imageSvg inline in review", () => {
    render(
      <ReviewScreen
        review={{
          attemptId: "attempt-1",
          items: [
            {
              ...reviewPayload.items[0],
              choices: [
                {
                  id: "choice-7-a",
                  label: "A",
                  isCorrect: true,
                  selected: true,
                  imageSvg:
                    '<svg data-testid="picture-a"><circle r="4" /></svg>',
                },
                {
                  id: "choice-7-b",
                  label: "B",
                  isCorrect: false,
                  selected: false,
                },
              ],
            },
          ],
        }}
      />,
    )

    expect(screen.getByTestId("picture-a")).toBeInTheDocument()
    expect(document.querySelectorAll(".choice-image")).toHaveLength(1)
  })

  it("renders an image stimulus's imageSvg inline, and no <img> alongside it", () => {
    render(
      <ReviewScreen
        review={{
          attemptId: "attempt-1",
          items: [
            {
              ...reviewPayload.items[0],
              stimulus: {
                id: "stimulus-word-picture",
                type: "image",
                imageSvg:
                  '<svg data-testid="stimulus-picture"><circle r="4" /></svg>',
                replayable: true,
              },
            },
          ],
        }}
      />,
    )

    expect(screen.getByTestId("stimulus-picture")).toBeInTheDocument()
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })

  it("moves through the loaded payload without a network refetch and respects both navigation bounds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(reviewPayload))
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    const review = await loadReview("attempt-1")
    render(<ReviewScreen review={review} />)

    const previous = screen.getByRole("button", { name: "Previous" })
    const next = screen.getByRole("button", { name: "Next" })
    expect(previous).toBeDisabled()
    expect(next).toBeEnabled()

    await user.click(next)

    expect(
      screen.getByText("Where are the children going?"),
    ).toBeInTheDocument()
    expect(previous).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/attempts/attempt-1/review")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()

    await user.click(screen.getByRole("button", { name: "Jump to a question" }))
    await user.click(screen.getByRole("button", { name: "Question 27" }))

    expect(next).toBeDisabled()
    await user.click(previous)
    expect(
      screen.getByText("Where are the children going?"),
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("labels the first section Listening and the next distinct section Reading", async () => {
    const user = userEvent.setup()
    render(<ReviewScreen review={reviewPayload} />)

    expect(screen.getByText("Listening")).toBeInTheDocument()
    expect(screen.queryByText("Reading")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Jump to a question" }))
    await user.click(screen.getByRole("button", { name: "Question 12" }))

    expect(screen.getByText("Reading")).toBeInTheDocument()
    expect(screen.queryByText("Listening")).not.toBeInTheDocument()
  })

  it("redirects to the runner when the attempt is still running (409)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        response(
          {
            type: "still_running",
            title: "Attempt still running",
            status: 409,
          },
          409,
        ),
      ),
    )

    const thrown: unknown = await loadReview("attempt-1").catch(
      (error: unknown) => error,
    )

    expect(isRedirect(thrown)).toBe(true)

    if (!isRedirect(thrown)) {
      throw new Error("Expected a TanStack Router redirect")
    }

    expect(thrown.options.href).toBe("/attempts/attempt-1/run")
  })

  it("renders the forbidden state for a 403 without inventing a 404 branch", () => {
    render(
      <ReviewRouteError
        error={
          new ApiError({
            type: "not_your_attempt",
            title: "The attempt belongs to another student.",
            status: 403,
          })
        }
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "You can't review this attempt.",
    )
  })

  it("renders the generic error state, not the forbidden one, for a non-403", () => {
    render(<ReviewRouteError error={new Error("network down")} />)

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The review could not be loaded. Please try again.",
    )
  })
})
