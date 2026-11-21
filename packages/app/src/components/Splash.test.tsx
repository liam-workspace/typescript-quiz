import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import "../i18n.js"
import { Splash } from "./Splash.js"

describe("Splash", () => {
  afterEach(cleanup)

  it("is visible with the brand, hidden from assistive tech either way", () => {
    const { container, rerender } = render(<Splash visible />)
    const splash = container.querySelector(".splash")

    expect(splash).toHaveAttribute("data-visible", "true")
    expect(splash).toHaveAttribute("aria-hidden", "true")
    expect(splash).toHaveTextContent("Primary Practice")

    rerender(<Splash visible={false} />)
    expect(container.querySelector(".splash")).toHaveAttribute(
      "data-visible",
      "false",
    )
  })
})
