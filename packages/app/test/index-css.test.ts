import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8")
/** The first rule whose selector list starts with `selector`, up to its `}`. */
const rule = (selector: string): string => {
  const at = css.search(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[ ,]`, "u"),
  )

  return at < 0 ? "" : css.slice(at, css.indexOf("}", at))
}

describe("index.css (D10, D14, D15)", () => {
  it("D10: the reminders switch's input reaches past the 32 px track to a 44 px target", () => {
    expect(rule("  .switch input")).toMatch(/inset: -6px -4px;/u)
  })

  it("D10: the visible track never catches the tap meant for the input beneath it", () => {
    expect(rule("  .switch i")).toMatch(/pointer-events: none;/u)
  })

  it("the app-bar back button keeps its 44 px and the brand and chip give way", () => {
    expect(rule("  .m-appbar .m-iconbtn")).toMatch(/flex: none;/u)
    expect(rule("  .m-appbar .m-brand")).toMatch(/text-overflow: ellipsis;/u)
  })

  it("a list row's title may shrink so the switch stays inside 320 px", () => {
    expect(rule("  .li .t")).toMatch(/min-width: 0;/u)
  })

  it("D14: a selected choice keeps its selected fill when it is disabled", () => {
    expect(
      rule('  .choice:has(:disabled):has([data-state="checked"])'),
    ).toMatch(/background: var\(--color-teal-bg\);/u)
  })

  it("D15: the alert and save-state colours come from tokens, not literals", () => {
    const tokens = css.slice(0, css.indexOf("@layer base"))
    const rest = css.slice(tokens.length)

    expect(rest).not.toMatch(/#b53a34/iu)
    expect(rest).not.toMatch(/#7a4d00/iu)
  })
})
