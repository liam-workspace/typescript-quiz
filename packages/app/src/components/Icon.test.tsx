import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Icon, type IconName } from "./Icon.js"

const NAMES: IconName[] = [
  "home",
  "clock",
  "user",
  "check",
  "x",
  "minus",
  "download",
  "back",
  "grid",
  "headphones",
  "play",
  "wifioff",
  "share",
  "plus",
  "bell",
  "chev",
  "trash",
  "book",
  "calc",
  "refresh",
  "logout",
  "more",
  "lock",
  "cloud",
  "alert",
]

describe("Icon", () => {
  afterEach(cleanup)

  it.each(NAMES)("%s renders decorative SVG geometry", (name) => {
    const { container } = render(<Icon name={name} />)
    const svg = container.querySelector("svg")

    expect(svg).toHaveAttribute("aria-hidden", "true")
    expect(svg).toHaveClass("i")
    expect(svg?.children.length).toBeGreaterThan(0)
  })

  it("adds the small modifier on request", () => {
    const { container } = render(<Icon name="check" small />)

    expect(container.querySelector("svg")).toHaveClass("sm")
  })
})
