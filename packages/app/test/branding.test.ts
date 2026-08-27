import { afterEach, describe, expect, it } from "vitest"
import { applyBranding } from "../src/branding.js"

describe("applyBranding", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("style")
  })

  it("sets CSS custom properties from theme.colors", () => {
    applyBranding({ colors: { primary: "#123456", secondary: "#abcdef" } })

    const root = document.documentElement
    expect(root.style.getPropertyValue("--color-primary")).toBe("#123456")
    expect(root.style.getPropertyValue("--color-secondary")).toBe("#abcdef")
  })

  it("is a no-op when theme is null", () => {
    const root = document.documentElement
    root.style.setProperty("--color-primary", "#000000")

    applyBranding(null)

    expect(root.style.getPropertyValue("--color-primary")).toBe("#000000")
  })
})
