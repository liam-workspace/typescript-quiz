import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { LibraryFilter } from "./LibraryFilter.js"

describe("LibraryFilter", () => {
  afterEach(cleanup)

  it("is a labelled group whose current choice is aria-pressed", () => {
    render(<LibraryFilter value="todo" onChange={vi.fn()} />)

    expect(
      screen.getByRole("group", { name: "Filter tests" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "To do" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
  })

  it("reports the chosen filter", async () => {
    const onChange = vi.fn()

    render(<LibraryFilter value="all" onChange={onChange} />)
    await userEvent.setup().click(screen.getByRole("button", { name: "Done" }))

    expect(onChange).toHaveBeenCalledWith("done")
  })
})
