import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import type { AttemptResult, FinalizedAttempt } from "../lib/api-types.js"
import { loadTimeUp, TimeUpScreen } from "./attempts.$attemptId.time-up.js"

const expiredResult: AttemptResult = {
  attemptId: "attempt-1",
  test: { title: "TOEFL Primary — Practice Test 04", version: 2 },
  status: "expired",
  submittedAt: "2026-08-28T10:25:00.000Z",
  elapsedSeconds: 1_500,
  score: {
    pointsEarned: 36,
    pointsPossible: 40,
    percentage: 90,
    answered: 38,
    unanswered: 2,
    correct: 36,
    incorrect: 2,
    isPersonalBest: true,
    sections: [],
  },
}

const finalizedAttempt: FinalizedAttempt = {
  id: "attempt-1",
  status: "expired",
  submittedAt: "2026-08-28T10:25:00.000Z",
  resultUrl: "/attempts/attempt-1/result?source=expiry",
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

describe("attempt time-up page", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("renders the clock, reassurance, answered count, and server-supplied result link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(response(expiredResult)),
    )

    const data = await loadTimeUp("attempt-1", finalizedAttempt)
    render(<TimeUpScreen data={data} />)

    expect(screen.getByLabelText("Time remaining")).toHaveTextContent("00:00")
    expect(screen.getByRole("heading", { name: "Time is up" })).toBeVisible()
    expect(
      screen.getByText(
        "Your test was handed in automatically. Everything saved before time ran out has been kept and marked.",
      ),
    ).toBeVisible()
    expect(screen.getByText("Answered").nextSibling).toHaveTextContent("38")
    expect(
      screen.getByRole("link", { name: "See your result" }),
    ).toHaveAttribute("href", "/attempts/attempt-1/result?source=expiry")
  })

  it("uses the time-up screen hierarchy for the finalized answer summary", () => {
    render(
      <TimeUpScreen
        data={{
          testTitle: "Practice Test 04",
          answeredCount: 38,
          unansweredCount: 2,
          resultUrl: "/attempts/attempt-1/result",
        }}
      />,
    )

    expect(screen.getByText("Practice Test 04").closest("header")).toHaveClass(
      "app-bar",
    )
    expect(
      screen.getByRole("heading", { level: 1, name: "Time is up" }),
    ).toHaveClass("screen-title")
    expect(screen.getByText("00:00")).toHaveClass("timer", "timer-low")
    expect(screen.getByText("Answered").parentElement).toHaveClass(
      "summary-row",
    )
    expect(screen.getByText("Answered").closest("section")).toHaveClass(
      "device-card",
    )
    expect(screen.getByRole("link", { name: "See your result" })).toHaveClass(
      "device-button",
    )
  })

  it("loads a direct reload from plain GET /result without a carried 410 payload", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(expiredResult))
    vi.stubGlobal("fetch", fetchMock)

    const data = await loadTimeUp("attempt-1")

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/attempts/attempt-1/result")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()
    expect(data).toMatchObject({
      answeredCount: 38,
      unansweredCount: 2,
      resultUrl: "/attempts/attempt-1/result",
    })

    render(<TimeUpScreen data={data} />)
    expect(
      screen.getByRole("link", { name: "See your result" }),
    ).toHaveAttribute("href", "/attempts/attempt-1/result")
  })

  it("does not render an unsafe result link carried by navigation state", async () => {
    const unsafeAttempt: FinalizedAttempt = {
      ...finalizedAttempt,
      resultUrl: ["java", "script:alert(1)"].join(""),
    }
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(response(expiredResult)),
    )

    const data = await loadTimeUp("attempt-1", unsafeAttempt)
    render(<TimeUpScreen data={data} />)

    expect(
      screen.queryByRole("link", { name: "See your result" }),
    ).not.toBeInTheDocument()
  })
})
