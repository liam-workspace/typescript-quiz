import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { ApiError } from "../lib/api-client.js"
import { HandInRouteError } from "../pages/attempts.$attemptId.hand-in.js"
import { ResultRouteError } from "../pages/attempts.$attemptId.result.js"
import { ReviewRouteError } from "../pages/attempts.$attemptId.review.js"
import { RunRouteError } from "../pages/attempts.$attemptId.run.js"
import { HistoryRouteError } from "../pages/history.js"
import { RouteErrorView } from "./RouteErrorView.js"

afterEach(cleanup)

const forbidden = new ApiError({ type: "forbidden", title: "x", status: 403 })

describe("route error screens are never a dead end (D6)", () => {
  it.each([
    ["Result", () => <ResultRouteError error={forbidden} />],
    ["Review", () => <ReviewRouteError error={new Error("x")} />],
    ["History", () => <HistoryRouteError error={new Error("x")} />],
    ["Hand-in", () => <HandInRouteError error={new Error("x")} />],
    ["Run", () => <RunRouteError error={new Error("x")} />],
  ])("%s: keeps its alert and offers Back to library", (_name, draw) => {
    render(draw())

    expect(screen.getByRole("alert")).not.toBeEmptyDOMElement()
    expect(
      screen.getByRole("link", { name: "Back to library" }),
    ).toHaveAttribute("href", "/")
    expect(document.querySelector("[data-slot=card]")).toBeNull()
  })

  it("runs the retry", async () => {
    const onRetry = vi.fn()

    render(
      <RouteErrorView message="m" retry={{ label: "Try again", onRetry }} />,
    )
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
