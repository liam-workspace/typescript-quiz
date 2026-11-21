import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ToastHost } from "./ToastHost.js"

describe("ToastHost", () => {
  afterEach(cleanup)

  it("renders nothing when there is no toast", () => {
    render(<ToastHost toast={null} />)

    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("renders the message in a status region with its icon", () => {
    const { container } = render(
      <ToastHost toast={{ id: 1, message: "Installed.", icon: "check" }} />,
    )

    expect(screen.getByRole("status")).toHaveTextContent("Installed.")
    expect(container.querySelector("svg")).toBeInTheDocument()
  })
})
