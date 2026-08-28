import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { SignInScreen } from "./sign-in.js"

describe("SignInScreen", () => {
  afterEach(() => {
    cleanup()
  })

  it("renders the prototype's title and subtitle", () => {
    render(<SignInScreen onSignIn={vi.fn()} starting={false} />)

    expect(
      screen.getByRole("heading", { name: "Primary Practice" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Listening and reading practice tests for TOEFL Primary, Steps 1 and 2.",
      ),
    ).toBeInTheDocument()
  })

  it("renders exactly one sign-in button whose copy names no provider", () => {
    render(<SignInScreen onSignIn={vi.fn()} starting={false} />)

    const buttons = screen.getAllByRole("button")

    expect(buttons).toHaveLength(1)

    const copy = buttons[0]?.textContent ?? ""

    // The gateway chooses between Google and Microsoft; naming either one
    // here is a lie to whoever holds the other kind of account.
    expect(copy.toLowerCase()).not.toContain("google")
    expect(copy.toLowerCase()).not.toContain("microsoft")
  })

  it("calls onSignIn (startSignIn) when the button is tapped", async () => {
    const user = userEvent.setup()
    const onSignIn = vi.fn()

    render(<SignInScreen onSignIn={onSignIn} starting={false} />)

    await user.click(screen.getByRole("button"))

    expect(onSignIn).toHaveBeenCalledOnce()
  })

  it("disables the button while sign-in is starting, so a double tap cannot fire two redirects", () => {
    render(<SignInScreen onSignIn={vi.fn()} starting />)

    expect(screen.getByRole("button")).toBeDisabled()
  })
})
