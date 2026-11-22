import "../i18n.js"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getAttemptResult } from "../lib/attempts-api.js"
import { loadWaitingSummary } from "../lib/attempt/waiting-summary.js"
import { loadTimeUp, TimeUpScreen } from "./attempts.$attemptId.time-up.js"

vi.mock("../lib/attempts-api.js", () => ({ getAttemptResult: vi.fn() }))
vi.mock("../lib/attempt/waiting-summary.js", () => ({
  loadWaitingSummary: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe("loadTimeUp", () => {
  it("returns the normal data when the result loads (and no waiting flag)", async () => {
    vi.mocked(getAttemptResult).mockResolvedValue({
      attemptId: "att-1",
      test: { title: "Practice Test 3", version: 1 },
      score: { answered: 2, unanswered: 1 },
    } as never)

    expect(await loadTimeUp("att-1")).toEqual({
      testTitle: "Practice Test 3",
      answeredCount: 2,
      unansweredCount: 1,
      resultUrl: "/attempts/att-1/result",
    })
    expect(loadWaitingSummary).not.toHaveBeenCalled()
  })

  it("returns the waiting variant when the server has no result but this device holds unsent work", async () => {
    vi.mocked(getAttemptResult).mockRejectedValue(
      new TypeError("Failed to fetch"),
    )
    vi.mocked(loadWaitingSummary).mockResolvedValue({
      testTitle: "Practice Test 3",
      answeredCount: 2,
      unansweredCount: 1,
    })

    expect(await loadTimeUp("att-1")).toEqual({
      testTitle: "Practice Test 3",
      answeredCount: 2,
      unansweredCount: 1,
      resultUrl: "/attempts/att-1/result",
      waiting: true,
    })
  })

  it("rethrows when nothing on this device explains the failure", async () => {
    const failure = new TypeError("Failed to fetch")

    vi.mocked(getAttemptResult).mockRejectedValue(failure)
    vi.mocked(loadWaitingSummary).mockResolvedValue(null)

    await expect(loadTimeUp("att-1")).rejects.toBe(failure)
  })

  it("rethrows the original failure when the local lookup itself fails", async () => {
    const failure = new TypeError("Failed to fetch")

    vi.mocked(getAttemptResult).mockRejectedValue(failure)
    vi.mocked(loadWaitingSummary).mockRejectedValue(new Error("idb"))

    await expect(loadTimeUp("att-1")).rejects.toBe(failure)
  })
})

describe("TimeUpScreen waiting variant", () => {
  const waiting = {
    testTitle: "Practice Test 3",
    answeredCount: 2,
    unansweredCount: 1,
    resultUrl: "/attempts/att-1/result",
    waiting: true as const,
  }

  it("explains the wait, disables See your result with a reason, and offers Check again", () => {
    const onCheckAgain = vi.fn()

    render(<TimeUpScreen data={waiting} onCheckAgain={onCheckAgain} />)

    expect(
      screen.getByText("We'll score it as soon as you're back online."),
    ).toBeInTheDocument()

    const see = screen.getByRole("button", { name: /see your result/i })

    expect(see).toBeDisabled()
    expect(see).toHaveAccessibleDescription("Your result isn't ready yet.")
    expect(screen.queryByRole("link", { name: /see your result/i })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Check again" }))
    expect(onCheckAgain).toHaveBeenCalledOnce()
  })

  it("a refused journal replaces Check again with the adult-help alert", () => {
    render(<TimeUpScreen data={waiting} syncFailed />)

    expect(screen.getByRole("alert")).toHaveTextContent("Please tell an adult")
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull()
  })

  it("the normal variant still links to the result", () => {
    render(
      <TimeUpScreen
        data={{
          testTitle: "T",
          answeredCount: 1,
          unansweredCount: 0,
          resultUrl: "/attempts/att-1/result",
        }}
      />,
    )

    expect(
      screen.getByRole("link", { name: /see your result/i }),
    ).toHaveAttribute("href", "/attempts/att-1/result")
  })
})
