import { cleanup, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import i18n from "../i18n.js"
import type { Student } from "../lib/api-types.js"
import type { PwaSnapshot } from "../lib/pwa/pwa-store.js"
import { renderWithRouter } from "../test/renderWithRouter.js"
import { OfflineStorageList } from "../components/OfflineStorageList.js"
import type { OfflineTestRecord } from "../lib/offline/offline-store.js"
import { ProfileScreen, SavedTestsList } from "./profile.js"

const student: Student = {
  id: "s1",
  displayName: "Minh Anh",
  email: "minh@example.com",
  level: "primary-step-1",
  isAdmin: false,
}

const browserTab: PwaSnapshot = {
  standalone: false,
  canPromptInstall: true,
  platform: "android",
  installDismissed: false,
  updateReady: false,
}

function renderProfile(
  overrides: Partial<Parameters<typeof ProfileScreen>[0]> = {},
) {
  const props: Parameters<typeof ProfileScreen>[0] = {
    student,
    pwa: browserTab,
    version: "4.1.0",
    reminders: { state: "unsupported", busy: false, onToggle: () => undefined },
    offlineStorage: (
      <OfflineStorageList items={[]} onRemove={() => undefined} />
    ),
    onInstall: () => undefined,
    onRefresh: () => undefined,
    onSignOut: () => undefined,
    ...overrides,
  }

  return renderWithRouter(<ProfileScreen {...props} />)
}

describe("ProfileScreen", () => {
  afterEach(async () => {
    cleanup()
    await i18n.changeLanguage("en")
  })

  it("names the student and how they signed in, under one h1", async () => {
    renderProfile()

    expect(
      await screen.findByRole("heading", { level: 1, name: "Profile" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Minh Anh")).toBeInTheDocument()
    expect(screen.getByText("Signed in with auth.icovn.me")).toBeInTheDocument()
  })

  it("offers Install in a browser tab and the Installed chip when running as an app", async () => {
    const user = userEvent.setup()
    const onInstall = vi.fn()

    const view = renderProfile({ onInstall })

    expect(await screen.findByText("Not installed")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Install" }))
    expect(onInstall).toHaveBeenCalledTimes(1)
    view.unmount()

    renderProfile({ pwa: { ...browserTab, standalone: true } })
    expect(
      await screen.findByText("Installed — running as an app"),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Install" }),
    ).not.toBeInTheDocument()
  })

  it("shows the version with up-to-date wording, or an update with a Refresh button", async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()

    const view = renderProfile()

    expect(await screen.findByText("4.1.0 · up to date")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Refresh" }),
    ).not.toBeInTheDocument()
    view.unmount()

    renderProfile({ pwa: { ...browserTab, updateReady: true }, onRefresh })
    expect(await screen.findByText("4.1.0 · update ready")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it("renders the reminders row and forwards toggles", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    renderProfile({ reminders: { state: "off", busy: false, onToggle } })

    await user.click(
      await screen.findByRole("switch", { name: "Practice reminders" }),
    )
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it("renders the injected offline-storage slot", async () => {
    renderProfile({
      offlineStorage: (
        <OfflineStorageList
          items={[
            {
              slug: "p3",
              title: "Practice Test 3",
              levelLabel: "Step 1",
              sizeMb: 18,
            },
          ]}
          onRemove={() => undefined}
        />
      ),
    })

    expect(await screen.findByText("Step 1 · 18 MB")).toBeInTheDocument()
  })

  it("lists saved tests with level and size and removes one by slug and title", async () => {
    const user = userEvent.setup()
    const remove = vi.fn()
    const record: OfflineTestRecord = {
      slug: "practice-3",
      testVersionId: "v1",
      version: 1,
      title: "Practice Test 3",
      level: "primary-step-1",
      totalBytes: 1000,
      savedAt: "2026-11-22T12:00:00.000Z",
    }

    renderProfile({
      offlineStorage: (
        <SavedTestsList
          offline={{ saved: new Map([[record.slug, record]]), remove }}
        />
      ),
    })

    expect(await screen.findByText("Practice Test 3")).toBeInTheDocument()
    expect(screen.getByText("Step 1 · 1 MB")).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", {
        name: "Remove Practice Test 3 from this phone",
      }),
    )
    expect(remove).toHaveBeenCalledWith("practice-3", "Practice Test 3")
  })

  it("switches the interface language", async () => {
    const user = userEvent.setup()

    renderProfile()
    await user.click(await screen.findByRole("button", { name: "fr" }))

    await waitFor(() => expect(i18n.resolvedLanguage).toBe("fr"))
    expect(screen.getByRole("button", { name: "fr" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  })

  it("shows the admin console link only to admins", async () => {
    const view = renderProfile()

    await screen.findByRole("heading", { level: 1 })
    expect(
      screen.queryByRole("link", { name: "Admin console" }),
    ).not.toBeInTheDocument()
    view.unmount()

    renderProfile({ student: { ...student, isAdmin: true } })
    expect(
      await screen.findByRole("link", { name: "Admin console" }),
    ).toHaveAttribute("href", "/admin")
  })

  it("asks before signing out, explains saved tests go too, and only then signs out", async () => {
    const user = userEvent.setup()
    const onSignOut = vi.fn()

    renderProfile({ onSignOut })

    await user.click(await screen.findByRole("button", { name: "Sign out" }))

    const dialog = screen.getByRole("dialog", { name: "Sign out?" })

    expect(dialog).toHaveTextContent(
      "Tests saved for offline use will be removed from this phone.",
    )
    expect(onSignOut).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(onSignOut).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Sign out" }))
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Sign out",
      }),
    )
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })
})
