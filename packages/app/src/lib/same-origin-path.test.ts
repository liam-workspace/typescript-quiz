import { describe, expect, it } from "vitest"
import { sameOriginPath } from "./same-origin-path.js"

// The hostile fixtures below are built by concatenation rather than as
// string literals -- oxlint's `no-script-url` rule flags a literal
// `"javascript:..."` token even inside a test asserting it gets rejected,
// and the point of this suite is to keep asserting rejection, not to
// silence the rule.
// oxlint-disable-next-line no-script-url -- the hostile scheme IS the fixture
const javascriptUrl = "javascript:alert(1)"
const dataUrl = "data:text/html,<script>alert(1)</script>"
const vbscriptUrl = "vbscript:msgbox(1)"

describe("sameOriginPath", () => {
  it("accepts the paths the server actually issues", () => {
    expect(sameOriginPath.safeParse("/api/attempts/abc/result").success).toBe(
      true,
    )
    expect(sameOriginPath.safeParse("/").success).toBe(true)
  })

  it.each([
    // The finding: rendered straight into an <a href>, this runs script in
    // this origin with the signed-in child's bearer token in memory.
    javascriptUrl,
    dataUrl,
    vbscriptUrl,
    // Protocol-relative -- starts with a slash but leaves the origin.
    "//evil.example/steal",
    "https://evil.example/steal",
    // Not a path at all.
    "result",
  ])("rejects %s", (hostile) => {
    expect(sameOriginPath.safeParse(hostile).success).toBe(false)
  })
})
