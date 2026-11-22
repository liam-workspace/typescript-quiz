import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TabBar } from "./TabBar.js"

const labels = {
  library: "Library",
  history: "History",
  profile: "Profile",
  nav: "Main",
}

describe("TabBar", () => {
  afterEach(cleanup)

  it("is a labelled navigation with three links and aria-current only on the active tab", () => {
    render(
      <TabBar active="history" labels={labels} onNavigate={() => undefined} />,
    )

    const nav = screen.getByRole("navigation", { name: "Main" })

    expect(nav).toHaveClass("tabbar")
    expect(screen.getAllByRole("link")).toHaveLength(3)
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(screen.getByRole("link", { name: "Library" })).not.toHaveAttribute(
      "aria-current",
    )
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute(
      "href",
      "/profile",
    )
  })

  it("navigates in-app on a plain click but leaves modified clicks to the browser", async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()

    render(<TabBar active="library" labels={labels} onNavigate={onNavigate} />)

    await user.click(screen.getByRole("link", { name: "Profile" }))
    expect(onNavigate).toHaveBeenCalledWith("profile")

    onNavigate.mockClear()
    // Jsdom cannot navigate; swallow the browser default after React has run.
    const swallow = (event: Event): void => event.preventDefault()
    document.addEventListener("click", swallow)
    await user.keyboard("{Control>}")
    await user.click(screen.getByRole("link", { name: "History" }))
    await user.keyboard("{/Control}")
    document.removeEventListener("click", swallow)
    expect(onNavigate).not.toHaveBeenCalled()
  })
})
