import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { RunMenuSheet } from "./RunMenuSheet.js"

const base = {
  open: true,
  onOpenChange: vi.fn(),
  clockStarted: true,
  onLeave: vi.fn(),
}

describe("RunMenuSheet", () => {
  afterEach(() => {
    cleanup()
    base.onLeave.mockReset()
    base.onOpenChange.mockReset()
  })

  it("is a dialog named Menu with the running-clock note", () => {
    render(<RunMenuSheet {...base} />)

    const dialog = screen.getByRole("dialog", { name: "Menu" })

    expect(
      within(dialog).getByText("The clock keeps running while you are away."),
    ).toBeInTheDocument()
  })

  it("uses the not-started note before the clock begins", () => {
    render(<RunMenuSheet {...base} clockStarted={false} />)

    expect(
      screen.getByText(
        "Nothing has started yet. The clock begins when you tap I'm ready.",
      ),
    ).toBeInTheDocument()
  })

  it("leaves the test or goes back to it", async () => {
    const user = userEvent.setup()

    render(<RunMenuSheet {...base} />)
    await user.click(screen.getByRole("button", { name: "Leave test" }))
    expect(base.onLeave).toHaveBeenCalledOnce()

    await user.click(screen.getByRole("button", { name: "Back to the test" }))
    expect(base.onOpenChange).toHaveBeenCalledWith(false)
  })
})
