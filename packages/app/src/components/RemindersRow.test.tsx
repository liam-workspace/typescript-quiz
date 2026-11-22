import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { RemindersRow } from "./RemindersRow.js"

describe("RemindersRow", () => {
  afterEach(cleanup)

  it("off: an unchecked, enabled switch described as Off", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(<RemindersRow state="off" onToggle={onToggle} />)

    const toggle = screen.getByRole("switch", { name: "Practice reminders" })

    expect(toggle).not.toBeChecked()
    expect(toggle).toBeEnabled()
    expect(toggle).toHaveAccessibleDescription("Off")
    await user.click(toggle)
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it("on: checked, shows the daily time, turning it off reports false", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(<RemindersRow state="on" onToggle={onToggle} />)

    expect(screen.getByRole("switch")).toBeChecked()
    expect(screen.getByRole("switch")).toHaveAccessibleDescription(
      "Daily at 4:30 pm",
    )
    await user.click(screen.getByRole("switch"))
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it.each([
    ["denied", "Blocked in your browser settings."],
    ["needs-install", "On iPhone, install the app first to turn reminders on."],
    ["unsupported", "This browser can't send reminders."],
  ] as const)(
    "%s: switch is disabled and the reason is shown",
    (state, reason) => {
      render(<RemindersRow state={state} onToggle={() => undefined} />)

      expect(screen.getByRole("switch")).toBeDisabled()
      expect(screen.getByRole("switch")).toHaveAccessibleDescription(reason)
    },
  )

  it.each([
    ["failed", "Reminders couldn't be turned on. Please try again."],
    [
      "offline",
      "You're offline. Connect to the internet to turn reminders on.",
    ],
    ["not-configured", "Reminders aren't available right now."],
    [
      "conflict",
      "Another sign-in was setting up reminders on this device. Please try again.",
    ],
    ["disable", "Reminders couldn't be turned off. Please try again."],
  ] as const)(
    "a %s problem is announced under the row, and the switch stays usable",
    (problem, message) => {
      render(
        <RemindersRow
          state="off"
          problem={problem}
          onToggle={() => undefined}
        />,
      )

      expect(screen.getByRole("alert")).toHaveTextContent(message)
      expect(screen.getByRole("switch")).toBeEnabled()
    },
  )

  it("no problem, no alert", () => {
    render(<RemindersRow state="off" onToggle={() => undefined} />)

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("busy: disables the switch while a change is in flight", () => {
    render(<RemindersRow state="off" busy onToggle={() => undefined} />)

    expect(screen.getByRole("switch")).toBeDisabled()
  })
})
