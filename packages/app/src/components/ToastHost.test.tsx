import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ToastHost } from "./ToastHost.js"

describe("ToastHost", () => {
  afterEach(cleanup)

  it("keeps an EMPTY status region mounted when there is no toast (C5)", () => {
    render(<ToastHost toast={null} />)

    expect(screen.getByRole("status")).toBeEmptyDOMElement()
  })

  it("renders the message in a status region with its icon", () => {
    const { container } = render(
      <ToastHost toast={{ id: 1, message: "Installed.", icon: "check" }} />,
    )

    expect(screen.getByRole("status")).toHaveTextContent("Installed.")
    expect(container.querySelector("svg")).toBeInTheDocument()
  })

  it("writes each toast into the SAME live element: never mounted with its text, never remounted per toast (C5)", () => {
    const { rerender } = render(<ToastHost toast={null} />)
    const region = screen.getByRole("status")

    rerender(
      <ToastHost toast={{ id: 1, message: "Installed.", icon: "check" }} />,
    )
    expect(screen.getByRole("status")).toBe(region)
    expect(region).toHaveTextContent("Installed.")

    rerender(
      <ToastHost toast={{ id: 2, message: "Back online.", icon: "cloud" }} />,
    )
    expect(screen.getByRole("status")).toBe(region)
    expect(region).toHaveTextContent("Back online.")
  })
})
