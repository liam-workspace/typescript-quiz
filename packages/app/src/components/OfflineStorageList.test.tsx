import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { OfflineStorageList } from "./OfflineStorageList.js"

describe("OfflineStorageList", () => {
  afterEach(cleanup)

  it("shows the empty explanation when nothing is saved", () => {
    render(<OfflineStorageList items={[]} onRemove={() => undefined} />)

    expect(
      screen.getByText(
        "Nothing saved yet. Use “Save offline” on a test while you're online.",
      ),
    ).toBeInTheDocument()
  })

  it("lists each saved test with level and size and a named Remove control", async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()

    render(
      <OfflineStorageList
        items={[
          {
            slug: "practice-3",
            title: "Practice Test 3",
            level: "Step 1",
            sizeMb: 18,
          },
          {
            slug: "practice-1-s2",
            title: "Practice Test 1",
            level: "Step 2",
            sizeMb: 21,
          },
        ]}
        onRemove={onRemove}
      />,
    )

    expect(screen.getByText("Step 1 · 18 MB")).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", {
        name: "Remove Practice Test 3 from this phone",
      }),
    )
    expect(onRemove).toHaveBeenCalledWith("practice-3")
  })
})
