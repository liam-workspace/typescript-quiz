import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { RunActionBar } from "./RunActionBar.js"

const handlers = {
  onPrevious: vi.fn(),
  onOpenNavigator: vi.fn(),
  onPrimary: vi.fn(),
}
const props = {
  showPrevious: true,
  answered: 2,
  total: 4,
  navigatorExpanded: false,
  primary: { kind: "next" as const, label: "Next", disabled: false },
  ...handlers,
}

describe("RunActionBar", () => {
  afterEach(() => {
    cleanup()
    for (const handler of Object.values(handlers)) {
      handler.mockReset()
    }
  })

  it("renders Previous only when asked and the navigator with n/N", () => {
    const { rerender } = render(<RunActionBar {...props} />)

    expect(screen.getByRole("button", { name: "Previous" })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Open the question navigator" }),
    ).toHaveTextContent("2/4")

    rerender(<RunActionBar {...props} showPrevious={false} />)
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull()
  })

  it("fires the primary action and shows its label", async () => {
    render(
      <RunActionBar
        {...props}
        primary={{ kind: "finish", label: "Finish Listening", disabled: false }}
      />,
    )

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Finish Listening" }))

    expect(handlers.onPrimary).toHaveBeenCalledOnce()
  })

  it("disables the primary action while a transition is busy", () => {
    render(
      <RunActionBar
        {...props}
        primary={{ kind: "finish", label: "Finish Listening", disabled: true }}
      />,
    )

    expect(
      screen.getByRole("button", { name: "Finish Listening" }),
    ).toBeDisabled()
  })

  it("renders no primary or previous action once the section has expired", () => {
    render(<RunActionBar {...props} showPrevious={false} primary={null} />)

    expect(screen.queryByRole("button", { name: "Next" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull()
    expect(
      screen.getByRole("button", { name: "Open the question navigator" }),
    ).toBeInTheDocument()
  })
})
