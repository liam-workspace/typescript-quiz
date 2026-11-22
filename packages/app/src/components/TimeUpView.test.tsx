import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { TimeUpView } from "./TimeUpView.js"

describe("TimeUpView", () => {
  afterEach(cleanup)

  it("renders the heading, message, a low clock and the tiles with label before value", () => {
    render(
      <TimeUpView
        heading="Time is up"
        message="Your test was handed in automatically."
        summary={{ answered: 38, blank: 2 }}
        action={{
          kind: "link",
          href: "/attempts/a/result",
          label: "See your result",
        }}
      />,
    )

    expect(
      screen.getByRole("heading", { level: 1, name: "Time is up" }),
    ).toHaveAttribute("tabindex", "-1")
    expect(
      screen.getByRole("timer", { name: "Time remaining" }),
    ).toHaveTextContent("00:00")
    expect(screen.getByText("Answered").nextSibling).toHaveTextContent("38")
    expect(screen.getByText("Left blank").nextSibling).toHaveTextContent("2")
    expect(
      screen.getByRole("link", { name: "See your result" }),
    ).toHaveAttribute("href", "/attempts/a/result")
    // C4: the action bar is pinned like the run screen's.
    expect(
      screen.getByRole("link", { name: "See your result" }).closest("footer"),
    ).toHaveAttribute("data-sticky", "true")
  })

  it("pins the waiting footer too (C4)", () => {
    render(
      <TimeUpView
        heading="Time is up"
        message="m"
        summary={null}
        action={null}
        waiting={{
          seeResultLabel: "See your result",
          reason: "Waiting",
          checkAgainLabel: "Check again",
          onCheckAgain: vi.fn(),
          failed: false,
          retryMessage: null,
        }}
      />,
    )

    expect(
      screen.getByRole("button", { name: "See your result" }).closest("footer"),
    ).toHaveAttribute("data-sticky", "true")
  })

  it("omits the tiles when there is no summary and can announce the message as an alert", () => {
    render(
      <TimeUpView
        heading="Time's up"
        message="This section's time ran out."
        messageRole="alert"
        summary={null}
        action={null}
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This section's time ran out.",
    )
    expect(screen.queryByText("Answered")).toBeNull()
  })

  it("runs a button action", async () => {
    const onClick = vi.fn()

    render(
      <TimeUpView
        heading="Time's up"
        message="m"
        summary={null}
        action={{ kind: "button", label: "Continue to Reading", onClick }}
      />,
    )
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Continue to Reading" }))

    expect(onClick).toHaveBeenCalledOnce()
  })
})
