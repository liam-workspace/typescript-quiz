import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import "../i18n.js"
import { SaveState } from "./SaveState.js"

describe("SaveState", () => {
  afterEach(cleanup)

  it("renders saving, saved, pending and failed as four distinct states with an icon each", () => {
    const { rerender, container } = render(<SaveState state="saving" />)

    expect(screen.getByRole("status")).toHaveTextContent("Saving…")
    expect(container.querySelector("svg")).not.toBeNull()

    rerender(<SaveState state="saved" />)
    expect(screen.getByRole("status")).toHaveTextContent("Saved")

    rerender(<SaveState state="pending" pendingCount={3} />)
    expect(screen.getByRole("status")).toHaveTextContent("Waiting to send: 3")
    expect(screen.getByRole("status")).not.toHaveTextContent("Saved")

    rerender(<SaveState state="failed" />)
    expect(screen.getByRole("status")).toHaveTextContent("Did not save")
  })

  it("exposes the prototype save-state treatment and current state", () => {
    render(<SaveState state="failed" />)

    expect(screen.getByRole("status")).toHaveClass("save-state")
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "failed")
  })
})
