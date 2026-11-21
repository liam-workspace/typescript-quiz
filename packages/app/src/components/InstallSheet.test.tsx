import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { InstallSheet } from "./InstallSheet.js"

describe("InstallSheet", () => {
  afterEach(cleanup)

  it("iOS: three numbered Share-menu steps and an 'I've added it' confirmation", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <InstallSheet
        open
        onOpenChange={() => undefined}
        kind="ios"
        onConfirm={onConfirm}
      />,
    )

    expect(
      screen.getByRole("dialog", { name: "Add to Home Screen" }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
    expect(
      screen.getByText("Safari installs apps from the Share menu."),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "I've added it" }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("manual: tells the student to use the browser menu, with a Close button instead of a confirmation", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(
      <InstallSheet
        open
        onOpenChange={onOpenChange}
        kind="manual"
        onConfirm={() => undefined}
      />,
    )

    expect(
      screen.getByRole("dialog", { name: "Install this app" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "I've added it" }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByText("Close", { selector: "button.btn" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
