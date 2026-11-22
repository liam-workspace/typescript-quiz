import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { FinishSectionSheet } from "./FinishSectionSheet.js"

const base = {
  open: true,
  onOpenChange: vi.fn(),
  sectionLabel: "Listening",
  blankCount: 0,
  busy: false,
  failed: false,
  onConfirm: vi.fn(),
}

describe("FinishSectionSheet", () => {
  afterEach(() => {
    cleanup()
    base.onConfirm.mockReset()
    base.onOpenChange.mockReset()
  })

  it("asks to finish the named section and says it cannot be revisited", () => {
    render(<FinishSectionSheet {...base} />)

    const dialog = screen.getByRole("dialog", { name: "Finish Listening?" })

    expect(
      within(dialog).getByText("You cannot come back to this section."),
    ).toBeInTheDocument()
  })

  it("counts blank questions, singular and plural", () => {
    const { rerender } = render(<FinishSectionSheet {...base} blankCount={1} />)

    expect(
      screen.getByText(
        "1 question is still blank. You cannot come back to this section.",
      ),
    ).toBeInTheDocument()

    rerender(<FinishSectionSheet {...base} blankCount={3} />)
    expect(
      screen.getByText(
        "3 questions are still blank. You cannot come back to this section.",
      ),
    ).toBeInTheDocument()
  })

  it("confirms with a busy button and can be dismissed with Keep working", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<FinishSectionSheet {...base} />)
    const dialog = screen.getByRole("dialog")

    await user.click(
      within(dialog).getByRole("button", { name: "Finish Listening" }),
    )
    expect(base.onConfirm).toHaveBeenCalledOnce()

    await user.click(
      within(dialog).getByRole("button", { name: "Keep working" }),
    )
    expect(base.onOpenChange).toHaveBeenCalledWith(false)

    rerender(<FinishSectionSheet {...base} busy />)
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Finish Listening",
      }),
    ).toBeDisabled()
  })

  it("shows the transition failure as an alert and keeps the sheet usable", () => {
    render(<FinishSectionSheet {...base} failed />)

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The next section could not be opened. Your answers are still safe on this device. Try again.",
    )
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Finish Listening",
      }),
    ).toBeEnabled()
  })
})
