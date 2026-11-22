import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { usePageTitleFocus } from "../src/lib/usePageTitleFocus.js"

function Harness({
  pathname,
  withTitle,
}: {
  pathname: string
  withTitle: boolean
}) {
  usePageTitleFocus(pathname)

  return withTitle ? (
    <h1 tabIndex={-1} data-page-title>
      Title
    </h1>
  ) : (
    <p>No title yet</p>
  )
}

describe("usePageTitleFocus", () => {
  it("focuses the page title when the resolved pathname changes", () => {
    const { rerender } = render(<Harness pathname="/" withTitle />)
    expect(document.activeElement).toHaveTextContent("Title")
    ;(document.activeElement as HTMLElement).blur()
    rerender(<Harness pathname="/history" withTitle />)
    expect(document.activeElement).toHaveTextContent("Title")
  })

  it("does not steal focus when the pathname is unchanged", () => {
    const { rerender } = render(<Harness pathname="/" withTitle />)
    const button = document.createElement("button")
    document.body.appendChild(button)
    button.focus()
    rerender(<Harness pathname="/" withTitle />)
    expect(document.activeElement).toBe(button)
    button.remove()
  })

  it("does nothing when the page has no title element", () => {
    expect(() =>
      render(<Harness pathname="/x" withTitle={false} />),
    ).not.toThrow()
  })
})
