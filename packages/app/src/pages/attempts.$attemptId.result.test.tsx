import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { isRedirect } from "@tanstack/react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { ApiError } from "../lib/api-client.js"
import type { AttemptResult } from "../lib/api-types.js"
import { renderWithRouter } from "../test/renderWithRouter.js"
import {
  ResultRouteError,
  ResultScreen,
  loadResult,
} from "./attempts.$attemptId.result.js"

const bestResult: AttemptResult = {
  attemptId: "attempt-1",
  test: { title: "TOEFL Primary — Practice Test 04", version: 2 },
  status: "submitted",
  submittedAt: "2026-08-25T08:48:34.000Z",
  elapsedSeconds: 2754,
  score: {
    pointsEarned: 36,
    pointsPossible: 40,
    percentage: 90,
    answered: 38,
    unanswered: 2,
    correct: 36,
    incorrect: 2,
    isPersonalBest: true,
    sections: [
      {
        title: "Listening",
        type: "listening",
        pointsEarned: 18,
        pointsPossible: 20,
      },
      {
        title: "Reading",
        type: "reading",
        pointsEarned: 18,
        pointsPossible: 20,
      },
    ],
  },
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

function renderResult(result: AttemptResult) {
  return renderWithRouter(
    <ResultScreen result={result} />,
    `/attempts/${result.attemptId}/result`,
  )
}

describe("attempt result page", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("renders the percentage, fraction, and per-section bars from GET /result", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(bestResult))
    vi.stubGlobal("fetch", fetchMock)

    const result = await loadResult("attempt-1")
    renderResult(result)

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/attempts/attempt-1/result")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()
    expect(screen.getByText("90%")).toBeInTheDocument()
    expect(screen.getByText("36 / 40")).toBeInTheDocument()
    expect(
      screen.getByRole("progressbar", { name: "Listening" }),
    ).toHaveAttribute("aria-valuenow", "18")
    expect(
      screen.getByRole("progressbar", { name: "Listening" }),
    ).toHaveAttribute("aria-valuemax", "20")
    expect(
      screen.getByRole("progressbar", { name: "Reading" }),
    ).toHaveAttribute("aria-valuenow", "18")
    expect(screen.getAllByText("18 / 20")).toHaveLength(2)
    expect(
      screen.getByRole("link", { name: "Back to library" }),
    ).toHaveAttribute("href", "/")
    expect(
      screen.getByRole("link", { name: "Review answers →" }),
    ).toHaveAttribute("href", "/attempts/attempt-1/review")
  })

  it("uses the prototype result shell and API-driven score treatments", () => {
    renderResult(bestResult)

    expect(screen.getByRole("banner")).toHaveClass("app-bar")
    expect(screen.getByRole("main")).toHaveClass("device-main")
    expect(screen.getByRole("contentinfo")).toHaveClass("device-footer")
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass(
      "screen-title",
    )

    const scoreRing = screen.getByTestId("score-ring")
    expect(scoreRing).toHaveClass("score-ring")
    expect(scoreRing).toHaveStyle("--score-pct: 90%")

    const listening = screen.getByText("Listening").closest("section")
    const reading = screen.getByText("Reading").closest("section")
    expect(listening).toHaveAttribute("data-section-type", "listening")
    expect(reading).toHaveAttribute("data-section-type", "reading")
    expect(screen.getByRole("progressbar", { name: "Listening" })).toHaveClass(
      "score-bar",
    )
    expect(
      screen.getByRole("progressbar", { name: "Listening" }).firstElementChild,
    ).toHaveClass("bg-teal")
    expect(
      screen.getByRole("progressbar", { name: "Reading" }).firstElementChild,
    ).toHaveClass("bg-clay")

    expect(
      screen.getByText(/not an official TOEFL Primary scaled score/i),
    ).toHaveClass("text-faint")
    expect(screen.getByRole("link", { name: "Back to library" })).toHaveClass(
      "device-button",
    )
    expect(screen.getByRole("link", { name: "Review answers →" })).toHaveClass(
      "device-button",
    )
  })

  it("shows a personal-best callout only when isPersonalBest is true", () => {
    renderResult(bestResult)

    expect(screen.getByText("Your best score so far.")).toBeInTheDocument()
  })

  it("does not show a personal-best callout when isPersonalBest is false", () => {
    renderResult({
      ...bestResult,
      attemptId: "attempt-2",
      score: {
        ...bestResult.score,
        pointsEarned: 28,
        percentage: 70,
        isPersonalBest: false,
      },
    })

    expect(
      screen.queryByText("Your best score so far."),
    ).not.toBeInTheDocument()
  })

  it("navigates back to the registered library route without reloading the document", async () => {
    const user = userEvent.setup()
    const { router } = renderWithRouter(
      <ResultScreen result={bestResult} />,
      "/attempts/attempt-1/result",
    )

    await user.click(screen.getByRole("link", { name: "Back to library" }))

    expect(router.state.location.pathname).toBe("/")
  })

  it("redirects to the runner rather than rendering a score when the attempt is still running (409)", async () => {
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

    const thrown: unknown = await loadResult("attempt-1").catch(
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
      <ResultRouteError
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
      "You can't view this result.",
    )
  })

  // The other direction. Without this, a ResultRouteError that treated
  // EVERY error as forbidden would pass the test above -- the same
  // half-blind shape that let four guards through earlier in this branch.
  it("renders the generic error state, not the forbidden one, for a non-403", () => {
    render(<ResultRouteError error={new Error("network down")} />)

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The result could not be loaded. Please try again.",
    )
  })
})
