import { act, cleanup, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import i18n from "../i18n.js"
import { ApiError } from "../lib/api-client.js"
import {
  createReminders,
  type PushEnvironment,
  type RemindersApi,
  type RemindersDeps,
} from "../lib/reminders.js"
import { toastStore } from "../lib/toast.js"
import { fakeJwt, fakePushBrowser, neverSettles } from "../test/fake-push.js"
import type { Student } from "../lib/api-types.js"
import type { PwaSnapshot } from "../lib/pwa/pwa-store.js"
import { renderWithRouter } from "../test/renderWithRouter.js"
import { OfflineStorageList } from "../components/OfflineStorageList.js"
import type { OfflineTestRecord } from "../lib/offline/offline-store.js"
import {
  ProfileScreen,
  SavedTestsList,
  useProfileReminders,
  type ProfileReminders,
} from "./profile.js"

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

function reminderProps(
  overrides: Partial<ProfileReminders> = {},
): ProfileReminders {
  return {
    state: "unsupported",
    busy: false,
    problem: null,
    sheetOpen: false,
    onToggle: () => undefined,
    onAllow: () => undefined,
    onDecline: () => undefined,
    ...overrides,
  }
}

function renderProfile(
  overrides: Partial<Parameters<typeof ProfileScreen>[0]> = {},
) {
  const props: Parameters<typeof ProfileScreen>[0] = {
    student,
    pwa: browserTab,
    version: "4.1.0",
    reminders: reminderProps(),
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

    renderProfile({ reminders: reminderProps({ state: "off", onToggle }) })

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

/**
 * The route's real wiring (useProfileReminders → useReminders → the real
 * reminders library) over an in-memory browser and server: only Notification,
 * PushManager and the HTTP calls are fake.
 */
describe("Profile reminders (integration)", () => {
  const toast = vi.fn<typeof toastStore.show>()

  beforeEach(() => {
    vi.spyOn(toastStore, "show").mockImplementation(toast)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    toast.mockReset()
  })

  function world(
    over: {
      browser?: ReturnType<typeof fakePushBrowser>
      push?: PushEnvironment | null
      key?: string | null
      platform?: "ios" | "android"
      standalone?: boolean
      put?: RemindersDeps["put"]
      remove?: RemindersDeps["remove"]
    } = {},
  ) {
    const browser = over.browser ?? fakePushBrowser()
    // A pre-existing subscription was made by this student on this browser.
    let marker: string | null = browser.live() ? "s1" : null
    const deps = {
      snapshot: () => ({
        platform: over.platform ?? "android",
        standalone: over.standalone ?? false,
        userAgent:
          over.platform === "ios"
            ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) Version/17.2 Mobile/15E148 Safari/604.1"
            : "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36",
      }),
      vapidKey: () => (over.key === undefined ? "AQAB" : over.key),
      push: () => (over.push === undefined ? browser.push : over.push),
      put:
        over.put ?? vi.fn<RemindersDeps["put"]>().mockResolvedValue(undefined),
      remove:
        over.remove ??
        vi.fn<RemindersDeps["remove"]>().mockResolvedValue(undefined),
      timezone: () => "Europe/Paris",
      locale: () => "en",
      marker: {
        get: () => marker,
        set: (value: string | null) => {
          marker = value
        },
      },
      token: () => fakeJwt("s1"),
      removeWithToken: vi.fn<RemindersDeps["removeWithToken"]>(),
    } satisfies RemindersDeps
    const api = createReminders(deps)

    return { api, deps, browser }
  }

  function Harness({ api }: { readonly api: RemindersApi }) {
    const reminders = useProfileReminders(api)

    return (
      <ProfileScreen
        student={student}
        pwa={browserTab}
        version="4.1.0"
        reminders={reminders}
        offlineStorage={null}
        onInstall={() => undefined}
        onRefresh={() => undefined}
        onSignOut={() => undefined}
      />
    )
  }

  function renderWith(api: RemindersApi) {
    return renderWithRouter(<Harness api={api} />)
  }

  const reminderSwitch = () =>
    screen.findByRole("switch", { name: "Practice reminders" })

  async function turnOn(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await reminderSwitch())
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Allow reminders?" }),
      ).getByRole("button", { name: "Allow" }),
    )
  }

  it("switch → soft ask → Allow → browser prompt → subscribe → PUT: on, with a toast", async () => {
    const user = userEvent.setup()
    const { api, deps, browser } = world()

    renderWith(api)
    await user.click(await reminderSwitch())

    expect(
      screen.getByRole("dialog", { name: "Allow reminders?" }),
    ).toBeInTheDocument()
    expect(browser.push.requestPermission).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Allow" }))

    await waitFor(async () => {
      expect(await reminderSwitch()).toBeChecked()
    })
    expect(await reminderSwitch()).toHaveAccessibleDescription(
      "Daily at 4:30 pm",
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(deps.put).toHaveBeenCalledWith(
      expect.objectContaining({
        hour: 16,
        minute: 30,
        timezone: "Europe/Paris",
      }),
    )
    expect(browser.live()).not.toBeNull()
    expect(toast).toHaveBeenCalledWith("Reminders turned on.", "bell")
  })

  it("Don't allow only closes the soft ask: still off, still usable, no prompt, no toast", async () => {
    const user = userEvent.setup()
    const { api, browser } = world()

    renderWith(api)
    await user.click(await reminderSwitch())
    await user.click(screen.getByRole("button", { name: "Don't allow" }))

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(await reminderSwitch()).not.toBeChecked()
    expect(await reminderSwitch()).toBeEnabled()
    expect(await reminderSwitch()).toHaveAccessibleDescription("Off")
    expect(browser.push.requestPermission).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it("a denial at the real browser prompt shows the blocked reason and 'Reminders blocked.'", async () => {
    const user = userEvent.setup()
    const { api, deps } = world({
      browser: fakePushBrowser({ prompt: "denied" }),
    })

    renderWith(api)
    await turnOn(user)

    await waitFor(async () => {
      expect(await reminderSwitch()).toBeDisabled()
    })
    expect(await reminderSwitch()).toHaveAccessibleDescription(
      "Blocked in your browser settings.",
    )
    expect(deps.put).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith("Reminders blocked.", "bell")
  })

  it.each([
    [
      "the server has no VAPID keys (503)",
      new ApiError({
        type: "reminders_not_configured",
        title: "x",
        status: 503,
      }),
      "Reminders aren't available right now.",
    ],
    [
      "the network is down",
      new TypeError("Failed to fetch"),
      "You're offline. Connect to the internet to turn reminders on.",
    ],
    [
      "another sign-in raced it (409)",
      new ApiError({
        type: "reminder_endpoint_conflict",
        title: "x",
        status: 409,
      }),
      "Another sign-in was setting up reminders on this device. Please try again.",
    ],
    [
      "the server failed (500)",
      new ApiError({ type: "internal", title: "x", status: 500 }),
      "Reminders couldn't be turned on. Please try again.",
    ],
  ])(
    "when the PUT fails because %s: the browser subscription is rolled back, the switch is off and the reason is shown",
    async (_name, error, message) => {
      const user = userEvent.setup()
      const { api, browser } = world({
        put: vi.fn<RemindersDeps["put"]>().mockRejectedValue(error),
      })

      renderWith(api)
      await turnOn(user)

      expect(await screen.findByRole("alert")).toHaveTextContent(message)
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      expect(await reminderSwitch()).not.toBeChecked()
      expect(await reminderSwitch()).toBeEnabled()
      expect(browser.push.subscribe).toHaveBeenCalledOnce()
      expect(browser.live()).toBeNull()
      expect(toast).not.toHaveBeenCalled()
    },
  )

  it("a push service the server does not allow (400) reads as 'this browser can't', not a generic error", async () => {
    const user = userEvent.setup()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { api, browser } = world({
      put: vi
        .fn<RemindersDeps["put"]>()
        .mockRejectedValue(
          new ApiError({ type: "invalid_body", title: "x", status: 400 }),
        ),
    })

    renderWith(api)
    await turnOn(user)

    await waitFor(async () => {
      expect(await reminderSwitch()).toBeDisabled()
    })
    expect(await reminderSwitch()).toHaveAccessibleDescription(
      "This browser can't send reminders.",
    )
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(browser.live()).toBeNull()
    expect(toast).toHaveBeenCalledWith(
      "This browser can't send reminders.",
      "bell",
    )
    expect(warn).toHaveBeenCalledOnce()
  })

  it.each([
    ["the permission API throws", "requestPermission"],
    ["pushManager.subscribe rejects", "subscribe"],
  ] as const)(
    "when %s: off, nothing subscribed, a generic retry message",
    async (_name, method) => {
      const user = userEvent.setup()
      const browser = fakePushBrowser()

      browser.push[method].mockRejectedValue(
        new DOMException("nope", "NotAllowedError"),
      )
      const { api, deps } = world({ browser })

      renderWith(api)
      await turnOn(user)

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Reminders couldn't be turned on. Please try again.",
      )
      expect(await reminderSwitch()).not.toBeChecked()
      expect(deps.put).not.toHaveBeenCalled()
      expect(browser.live()).toBeNull()
    },
  )

  it("turning it off DELETEs, unsubscribes the browser and toasts 'Reminders turned off.'", async () => {
    const user = userEvent.setup()
    const { api, deps, browser } = world({
      browser: fakePushBrowser({ permission: "granted", subscribed: true }),
    })

    renderWith(api)
    await waitFor(async () => {
      expect(await reminderSwitch()).toBeChecked()
    })
    await user.click(await reminderSwitch())

    await waitFor(async () => {
      expect(await reminderSwitch()).not.toBeChecked()
    })
    expect(deps.remove).toHaveBeenCalledOnce()
    expect(browser.live()).toBeNull()
    expect(toast).toHaveBeenCalledWith("Reminders turned off.", "bell")
  })

  it("turning it off while offline still stops delivery in the browser", async () => {
    const user = userEvent.setup()
    const { api, browser } = world({
      browser: fakePushBrowser({ permission: "granted", subscribed: true }),
      remove: vi
        .fn<RemindersDeps["remove"]>()
        .mockRejectedValue(new TypeError("offline")),
    })

    renderWith(api)
    await waitFor(async () => {
      expect(await reminderSwitch()).toBeChecked()
    })
    await user.click(await reminderSwitch())

    await waitFor(async () => {
      expect(await reminderSwitch()).not.toBeChecked()
    })
    expect(browser.live()).toBeNull()
  })

  it("a browser that refuses to unsubscribe still reads off once the server row is gone", async () => {
    const user = userEvent.setup()
    const browser = fakePushBrowser({ permission: "granted", subscribed: true })

    browser.live()?.unsubscribe.mockRejectedValue(new Error("nope"))
    const { api, deps } = world({ browser })

    renderWith(api)
    await waitFor(async () => {
      expect(await reminderSwitch()).toBeChecked()
    })
    await user.click(await reminderSwitch())

    await waitFor(async () => {
      expect(await reminderSwitch()).not.toBeChecked()
    })
    expect(deps.remove).toHaveBeenCalledOnce()
    expect(toast).toHaveBeenCalledWith("Reminders turned off.", "bell")
  })

  it("focus returns to the switch after Allow turns reminders on", async () => {
    const user = userEvent.setup()

    renderWith(world().api)
    await turnOn(user)

    await waitFor(async () => {
      expect(await reminderSwitch()).toBeChecked()
    })
    await waitFor(async () => {
      expect(await reminderSwitch()).toHaveFocus()
    })
  })

  it("focus returns to the switch after Don't allow", async () => {
    const user = userEvent.setup()

    renderWith(world().api)
    await user.click(await reminderSwitch())
    await user.click(screen.getByRole("button", { name: "Don't allow" }))

    await waitFor(async () => {
      expect(await reminderSwitch()).toHaveFocus()
    })
  })

  it("focus returns to the row's reason (not <body>) when a denial leaves the switch disabled", async () => {
    const user = userEvent.setup()

    renderWith(world({ browser: fakePushBrowser({ prompt: "denied" }) }).api)
    await turnOn(user)

    await waitFor(() => {
      expect(
        screen.getByText("Blocked in your browser settings."),
      ).toHaveFocus()
    })
    expect(await reminderSwitch()).toBeDisabled()
  })

  it("focus returns to the switch after a failed turn-on (it stays usable)", async () => {
    const user = userEvent.setup()
    const { api } = world({
      put: vi
        .fn<RemindersDeps["put"]>()
        .mockRejectedValue(new TypeError("Failed to fetch")),
    })

    renderWith(api)
    await turnOn(user)

    await screen.findByRole("alert")
    await waitFor(async () => {
      expect(await reminderSwitch()).toHaveFocus()
    })
  })

  it("Escape while the browser prompt is up does not close the sheet mid-request", async () => {
    const user = userEvent.setup()
    const browser = fakePushBrowser()

    browser.push.requestPermission.mockReturnValue(neverSettles())
    renderWith(world({ browser }).api)
    await turnOn(user)
    await user.keyboard("{Escape}")

    expect(
      screen.getByRole("dialog", { name: "Allow reminders?" }),
    ).toBeInTheDocument()
  })

  it.each([
    [
      "denied in the browser",
      () => world({ browser: fakePushBrowser({ permission: "denied" }) }),
      "Blocked in your browser settings.",
    ],
    [
      "an iPhone browser tab",
      () => world({ platform: "ios", standalone: false, push: null }),
      "On iPhone, install the app first to turn reminders on.",
    ],
    [
      "a build without a VAPID key",
      () => world({ key: null }),
      "This browser can't send reminders.",
    ],
    [
      "a browser without Push",
      () => world({ push: null }),
      "This browser can't send reminders.",
    ],
  ] as const)(
    "%s: the switch is disabled and the row says why",
    async (_name, make, reason) => {
      renderWith(make().api)

      await waitFor(async () => {
        expect(await reminderSwitch()).toHaveAccessibleDescription(reason)
      })
      expect(await reminderSwitch()).toBeDisabled()
    },
  )

  it("re-reads the real permission when the page becomes visible again", async () => {
    const browser = fakePushBrowser()
    const { api } = world({ browser })

    renderWith(api)
    await waitFor(async () => {
      expect(await reminderSwitch()).toBeEnabled()
    })

    browser.setPermission("denied")
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })

    await waitFor(async () => {
      expect(await reminderSwitch()).toHaveAccessibleDescription(
        "Blocked in your browser settings.",
      )
    })
  })
})
