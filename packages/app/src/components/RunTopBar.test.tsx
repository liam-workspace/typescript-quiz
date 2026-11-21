import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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

  it("marks the timer low at one minute and announces it once", () => {
    render(<RunTopBar {...props} remainingMs={59_000} />)

    expect(
      screen.getByRole("timer", { name: "Time remaining" }),
    ).toHaveAttribute("data-low", "true")
    // Spoken once through a polite live region; the ticking timer itself is
    // never announced (role="timer" is aria-live off by default).
    expect(screen.getByText("One minute left.")).toHaveAttribute(
      "aria-live",
      "polite",
    )
    expect(
      screen.getByRole("timer", { name: "Time remaining" }),
    ).not.toHaveAttribute("aria-live")
  })

  it("is not low with exactly 61 seconds left", () => {
    render(<RunTopBar {...props} remainingMs={61_000} />)

    expect(
      screen.getByRole("timer", { name: "Time remaining" }),
    ).not.toHaveAttribute("data-low")
    expect(screen.queryByText("One minute left.")).toBeNull()
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
