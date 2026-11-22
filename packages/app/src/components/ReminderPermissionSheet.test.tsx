import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { ReminderPermissionSheet } from "./ReminderPermissionSheet.js"

describe("ReminderPermissionSheet", () => {
  afterEach(cleanup)

  it("is a named dialog with the prototype copy and the two choices", () => {
    render(
      <ReminderPermissionSheet
        open
        busy={false}
        onAllow={vi.fn()}
        onDecline={vi.fn()}
      />,
    )

    const dialog = screen.getByRole("dialog", { name: "Allow reminders?" })

    expect(dialog).toHaveTextContent(
      "Primary Practice would like to send a short reminder to practise each afternoon.",
    )
    expect(screen.getByRole("button", { name: "Allow" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Don't allow" })).toBeEnabled()
  })

  it("Allow and Don't allow call their handlers", async () => {
    const onAllow = vi.fn()
    const onDecline = vi.fn()
    const user = userEvent.setup()

    render(
      <ReminderPermissionSheet
        open
        busy={false}
        onAllow={onAllow}
        onDecline={onDecline}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Allow" }))
    await user.click(screen.getByRole("button", { name: "Don't allow" }))

    expect(onAllow).toHaveBeenCalledOnce()
    expect(onDecline).toHaveBeenCalledOnce()
  })

  it("Escape closes it the same way as Don't allow", async () => {
    const onDecline = vi.fn()
    const user = userEvent.setup()

    render(
      <ReminderPermissionSheet
        open
        busy={false}
        onAllow={vi.fn()}
        onDecline={onDecline}
      />,
    )

    await user.keyboard("{Escape}")

    expect(onDecline).toHaveBeenCalledOnce()
  })

  it("disables both choices and marks Allow busy while the browser prompt is up", () => {
    render(
      <ReminderPermissionSheet
        open
        busy
        onAllow={vi.fn()}
        onDecline={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "Allow" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Allow" })).toHaveAttribute(
      "aria-busy",
      "true",
    )
    expect(screen.getByRole("button", { name: "Don't allow" })).toBeDisabled()
  })

  it("renders nothing when closed", () => {
    render(
      <ReminderPermissionSheet
        open={false}
        busy={false}
        onAllow={vi.fn()}
        onDecline={vi.fn()}
      />,
    )

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
