import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { ChoiceList } from "./ChoiceList.js"

const choices = [
  { id: "c-1", label: "A dog" },
  { id: "c-2", label: "A cat" },
]

describe("ChoiceList", () => {
  afterEach(() => {
    cleanup()
  })

  it("calls onSelect with the clicked choice's id", async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <ChoiceList
        choices={choices}
        selectedId={null}
        onSelect={onSelect}
        locked={false}
      />,
    )

    await user.click(screen.getByRole("radio", { name: "A cat" }))

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("c-2")
  })

  it("renders the currently selected choice with aria-checked=true", () => {
    render(
      <ChoiceList
        choices={choices}
        selectedId="c-1"
        onSelect={vi.fn()}
        locked={false}
      />,
    )

    expect(screen.getByRole("radio", { name: "A dog" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    expect(screen.getByRole("radio", { name: "A cat" })).toHaveAttribute(
      "aria-checked",
      "false",
    )
  })

  it("does not call onSelect when locked is true", async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <ChoiceList
        choices={choices}
        selectedId={null}
        onSelect={onSelect}
        locked={true}
      />,
    )

    await user.click(screen.getByRole("radio", { name: "A cat" }))

    expect(onSelect).not.toHaveBeenCalled()
  })

  it("renders a lock indicator when locked is true", () => {
    render(
      <ChoiceList
        choices={choices}
        selectedId="c-1"
        onSelect={vi.fn()}
        locked={true}
      />,
    )

    expect(
      screen.getByText("Answer locked — this section does not allow changes."),
    ).toBeInTheDocument()
  })

  it("renders no lock indicator when locked is false", () => {
    render(
      <ChoiceList
        choices={choices}
        selectedId="c-1"
        onSelect={vi.fn()}
        locked={false}
      />,
    )

    expect(
      screen.queryByText(
        "Answer locked — this section does not allow changes.",
      ),
    ).not.toBeInTheDocument()
  })
})
