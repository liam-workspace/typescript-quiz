import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import "../i18n.js"
import { SaveState } from "./SaveState.js"

describe("SaveState", () => {
  afterEach(cleanup)

  it("renders saving, saved, and pending as three visibly distinct states", () => {
    const { rerender } = render(<SaveState state="saving" />)

    expect(screen.getByRole("status")).toHaveTextContent("Saving…")

    rerender(<SaveState state="saved" />)
    expect(screen.getByRole("status")).toHaveTextContent("Saved")
    expect(screen.getByRole("status")).not.toHaveTextContent("Saving…")

    rerender(<SaveState state="pending" pendingCount={3} />)
    expect(screen.getByRole("status")).toHaveTextContent(
      "Waiting to be sent: 3",
    )
    expect(screen.getByRole("status")).not.toHaveTextContent("Saved")
  })

  it("exposes the prototype save-state treatment and current state", () => {
    render(<SaveState state="failed" />)

    expect(screen.getByRole("status")).toHaveClass("save-state")
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "failed")
  })
})
