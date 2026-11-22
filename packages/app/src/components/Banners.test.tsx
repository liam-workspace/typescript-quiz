import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { InstallCard, OfflineBanner, UpdateBanner } from "./Banners.js"

describe("OfflineBanner", () => {
  afterEach(cleanup)

  it("browsing: says what is on screen is saved, no keep-answering advice", () => {
    render(<OfflineBanner variant="browsing" pendingCount={0} />)

    expect(screen.getByTestId("offline-banner")).toHaveAttribute(
      "data-variant",
      "browsing",
    )
    expect(screen.getByTestId("offline-banner")).toHaveTextContent(
      "You're offline. Showing what is saved on this phone.",
    )
    // C5: the layout's one live region announces it; no second region here.
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(screen.queryByText(/Waiting to be sent/u)).not.toBeInTheDocument()
  })

  it("in-test: tells the student to keep answering and shows the queue", () => {
    render(<OfflineBanner variant="in-test" pendingCount={3} />)

    expect(screen.getByTestId("offline-banner")).toHaveTextContent(
      "Keep answering",
    )
    expect(screen.getByTestId("offline-banner")).toHaveTextContent(
      "Waiting to be sent: 3",
    )
  })
})

describe("UpdateBanner", () => {
  afterEach(cleanup)

  it("offers Refresh outside a test", async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()

    const { container } = render(
      <UpdateBanner deferred={false} onRefresh={onRefresh} />,
    )

    expect(container).toHaveTextContent("A new version is ready.")
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it("inside a test has no button and says it will install afterwards", () => {
    const { container } = render(
      <UpdateBanner deferred onRefresh={() => undefined} />,
    )

    expect(container).toHaveTextContent(
      "It will install after you finish this test.",
    )
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})

describe("InstallCard", () => {
  afterEach(cleanup)

  it("is a labelled section with Install and Not now", async () => {
    const user = userEvent.setup()
    const onInstall = vi.fn()
    const onDismiss = vi.fn()

    render(<InstallCard onInstall={onInstall} onDismiss={onDismiss} />)

    expect(
      screen.getByRole("region", {
        name: "Add Primary Practice to your home screen",
      }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Install" }))
    await user.click(screen.getByRole("button", { name: "Not now" }))
    expect(onInstall).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
