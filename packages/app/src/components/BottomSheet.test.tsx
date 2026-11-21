import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createRef, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BottomSheet } from "./BottomSheet.js"

function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const trigger = createRef<HTMLButtonElement>()

  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(true)}>
        Open sheet
      </button>
      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          onOpenChange?.(next)
          setOpen(next)
        }}
        title="Sign out?"
        closeLabel="Close"
        returnFocusRef={trigger}
      >
        <p>Body copy</p>
      </BottomSheet>
    </>
  )
}

describe("BottomSheet", () => {
  afterEach(cleanup)

  it("is a modal dialog named by its title, with a labelled close control", async () => {
    const user = userEvent.setup()

    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Open sheet" }))

    expect(
      screen.getByRole("dialog", { name: "Sign out?" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Body copy")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument()
  })

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(<Harness onOpenChange={onOpenChange} />)
    await user.click(screen.getByRole("button", { name: "Open sheet" }))
    await user.keyboard("{Escape}")

    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open sheet" })).toHaveFocus()
  })

  it("closes from the close button", async () => {
    const user = userEvent.setup()

    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Open sheet" }))
    await user.click(screen.getByRole("button", { name: "Close" }))

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
