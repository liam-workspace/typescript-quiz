import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AppShell } from "./layout.js"

describe("AppShell", () => {
  it("renders the app shell without throwing", () => {
    render(<AppShell />)

    expect(screen.getByRole("main")).toBeInTheDocument()
  })
})
