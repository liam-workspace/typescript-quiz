import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { RunTopBar } from "./RunTopBar.js"

const props = {
  sectionType: "listening" as const,
  saveState: { state: "saved" as const },
  remainingMs: 125_000,
  answered: 1,
  total: 4,
  menuExpanded: false,
  onOpenMenu: vi.fn(),
}

describe("RunTopBar", () => {
  afterEach(() => {
    cleanup()
    props.onOpenMenu.mockReset()
  })

  it("shows the section chip, save state and a labelled timer", () => {
    render(<RunTopBar {...props} />)

    expect(screen.getByText("Listening")).toHaveClass("section-chip")
    expect(screen.getByText("Saved")).toBeInTheDocument()
    expect(
      screen.getByRole("timer", { name: "Time remaining" }),
    ).toHaveTextContent("02:05")
  })

  it("marks the timer low at one minute with an icon, not colour alone", () => {
    render(<RunTopBar {...props} remainingMs={59_000} />)

    const timer = screen.getByRole("timer", { name: "Time remaining" })

    expect(timer).toHaveAttribute("data-low", "true")
    expect(timer.querySelector("svg")).not.toBeNull()
    // The ticking timer itself is never announced (role="timer" is
    // aria-live off by default).
    expect(timer).not.toHaveAttribute("aria-live")
  })

  it("is not low with exactly 61 seconds left", () => {
    render(<RunTopBar {...props} remainingMs={61_000} />)

    const timer = screen.getByRole("timer", { name: "Time remaining" })

    expect(timer).not.toHaveAttribute("data-low")
    expect(timer.querySelector("svg")).toBeNull()
  })

  it("hands the page an empty polite live region for the one-minute warning", () => {
    const announcementRef = createRef<HTMLParagraphElement>()

    render(
      <RunTopBar
        {...props}
        remainingMs={59_000}
        announcementRef={announcementRef}
      />,
    )

    // RunTopBar never writes it: the page does, once no sheet hides it.
    expect(announcementRef.current).toHaveAttribute("aria-live", "polite")
    expect(announcementRef.current?.textContent).toBe("")
  })

  it("omits the timer before the clock has started", () => {
    render(<RunTopBar {...props} remainingMs={null} />)

    expect(screen.queryByRole("timer")).toBeNull()
  })

  it("reports section progress through a labelled progressbar", () => {
    render(<RunTopBar {...props} />)

    const bar = screen.getByRole("progressbar", { name: "Section progress" })

    expect(bar).toHaveAttribute("aria-valuenow", "1")
    expect(bar).toHaveAttribute("aria-valuemax", "4")
  })

  it("opens the menu from a 44px-class icon button with the Open menu label", async () => {
    render(<RunTopBar {...props} />)

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Open menu" }))

    expect(props.onOpenMenu).toHaveBeenCalledOnce()
  })
})
