import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import "../i18n.js"
import { PendingSyncNote } from "./PendingSyncNote.js"

describe("PendingSyncNote", () => {
  afterEach(cleanup)

  it("renders nothing when nothing is waiting", () => {
    const { container } = render(
      <PendingSyncNote pendingAttempts={0} failed={false} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("says the test is saved on this phone while something is waiting", () => {
    render(<PendingSyncNote pendingAttempts={1} failed={false} />)

    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved on this phone — it will be sent when you're back online.",
    )
  })

  it("a refused journal is an alert, and wins over the waiting note", () => {
    render(<PendingSyncNote pendingAttempts={1} failed />)

    expect(screen.getByRole("alert")).toHaveTextContent("Please tell an adult")
    expect(screen.queryByRole("status")).toBeNull()
  })
})
