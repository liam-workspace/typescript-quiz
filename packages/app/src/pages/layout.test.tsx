import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AppShell } from "./layout.js"

describe("AppShell", () => {
  it("does not add generic Card padding around full-height device pages", () => {
    render(
      <AppShell>
        <div data-testid="device-page" />
      </AppShell>,
    )

    expect(screen.getByRole("main")).toBeInTheDocument()
    expect(
      screen.getByTestId("device-page").parentElement?.parentElement,
    ).toHaveClass("min-h-screen")
    expect(
      screen.getByTestId("device-page").parentElement?.parentElement,
    ).not.toHaveAttribute("data-slot", "card")
  })
})
