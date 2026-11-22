import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { SaveOfflineControl } from "./SaveOfflineControl.js"

describe("SaveOfflineControl", () => {
  afterEach(cleanup)

  it("none: shows a labelled Save button that calls onSave", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    render(
      <SaveOfflineControl
        title="Practice Test 3"
        sizeMb={18}
        state={{ kind: "none" }}
        online
        onSave={onSave}
      />,
    )
    await user.click(
      screen.getByRole("button", {
        name: "Save Practice Test 3 for offline use",
      }),
    )

    expect(onSave).toHaveBeenCalledOnce()
    expect(screen.getByText("Save offline · 18 MB")).toBeInTheDocument()
  })

  it("none + offline: the button is disabled", () => {
    render(
      <SaveOfflineControl
        title="T"
        sizeMb={1}
        state={{ kind: "none" }}
        online={false}
        onSave={() => undefined}
      />,
    )

    expect(screen.getByRole("button")).toBeDisabled()
  })

  it("saving: a status with the percentage and no button", () => {
    render(
      <SaveOfflineControl
        title="T"
        sizeMb={1}
        state={{ kind: "saving", percent: 40 }}
        online
        onSave={() => undefined}
      />,
    )

    expect(screen.getByRole("status")).toHaveTextContent("Saving… 40%")
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("ready: shows Available offline; stale adds Update saved copy", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const { rerender } = render(
      <SaveOfflineControl
        title="T"
        sizeMb={1}
        state={{ kind: "ready", stale: false }}
        online
        onSave={onSave}
      />,
    )

    expect(screen.getByText("Available offline")).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()

    rerender(
      <SaveOfflineControl
        title="T"
        sizeMb={1}
        state={{ kind: "ready", stale: true }}
        online
        onSave={onSave}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Update saved copy" }))

    expect(onSave).toHaveBeenCalledOnce()
  })

  it("ready + stale + offline: the update button is disabled", () => {
    render(
      <SaveOfflineControl
        title="T"
        sizeMb={1}
        state={{ kind: "ready", stale: true }}
        online={false}
        onSave={() => undefined}
      />,
    )

    expect(
      screen.getByRole("button", { name: "Update saved copy" }),
    ).toBeDisabled()
  })
})
