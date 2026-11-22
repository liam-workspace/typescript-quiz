import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../src/lib/api-client.js"
import {
  ReminderError,
  createReminders,
  iosVersion,
  unsubscribeOnSignOut,
  urlBase64ToUint8Array,
  type PushEnvironment,
  type RemindersDeps,
} from "../src/lib/reminders.js"
import { tokenStore } from "../src/lib/tokenStore.js"

const IPHONE_17 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1"
const IPHONE_16_3 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1"
const IPAD_DESKTOP_16_4 =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15"
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"

function fakeSubscription(overrides: Partial<PushSubscriptionJSON> = {}) {
  const unsubscribe = vi.fn().mockResolvedValue(true)

  return {
    unsubscribe,
    toJSON: () => ({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      expirationTime: null,
      keys: { p256dh: "p256dh-key", auth: "auth-secret" },
      ...overrides,
    }),
  } as unknown as PushSubscription & { unsubscribe: typeof unsubscribe }
}

/**
 * A browser in memory: Notification.permission, PushManager and the
 * worker registration, with a real subscribe → getSubscription → unsubscribe
 * lifecycle, so "the switch is truthful" is checked against what the
 * browser would really report afterwards.
 */
function fakeBrowser(
  initial: {
    permission?: NotificationPermission
    prompt?: NotificationPermission
    subscribed?: boolean
  } = {},
) {
  let permission: NotificationPermission = initial.permission ?? "default"
  let live: ReturnType<typeof fakeSubscription> | null = null
  const issue = () => {
    const subscription = fakeSubscription()

    subscription.unsubscribe.mockImplementation(() => {
      if (live === subscription) {
        live = null
      }

      return Promise.resolve(true)
    })
    live = subscription

    return subscription
  }

  if (initial.subscribed) {
    issue()
  }

  const push = {
    permission: vi.fn(() => permission),
    requestPermission: vi.fn(() => {
      permission = initial.prompt ?? "granted"

      return Promise.resolve(permission)
    }),
    getSubscription: vi.fn(() => Promise.resolve(live)),
    subscribe: vi.fn((key: Uint8Array<ArrayBuffer>) => {
      void key

      return Promise.resolve(live ?? issue())
    }),
  } satisfies PushEnvironment

  return { push, live: () => live }
}

function setup(
  over: {
    platform?: "ios" | "android" | "other"
    standalone?: boolean
    userAgent?: string
    key?: string | null
    push?: PushEnvironment | null
    put?: RemindersDeps["put"]
    remove?: RemindersDeps["remove"]
    marker?: string | null
    student?: string | null
    token?: string | null
  } = {},
) {
  const browser = fakeBrowser()
  const push = over.push === undefined ? browser.push : over.push
  let marker = over.marker ?? null
  const deps = {
    snapshot: () => ({
      platform: over.platform ?? "android",
      standalone: over.standalone ?? false,
      userAgent: over.userAgent ?? ANDROID,
    }),
    vapidKey: () => (over.key === undefined ? "AQAB" : over.key),
    push: () => push,
    put: over.put ?? vi.fn<RemindersDeps["put"]>().mockResolvedValue(undefined),
    remove:
      over.remove ??
      vi.fn<RemindersDeps["remove"]>().mockResolvedValue(undefined),
    timezone: () => "America/New_York",
    locale: () => "fr",
    marker: {
      get: () => marker,
      set: (value: string | null) => {
        marker = value
      },
    },
    student: () => (over.student === undefined ? "student-a" : over.student),
    token: () => (over.token === undefined ? "bearer-a" : over.token),
    removeWithToken: vi.fn<RemindersDeps["removeWithToken"]>(),
  } satisfies RemindersDeps

  return {
    api: createReminders(deps),
    deps,
    browser,
    marker: () => marker,
  }
}

function problem(status: number, type: string): ApiError {
  return new ApiError({ type, title: type, status })
}

describe("urlBase64ToUint8Array", () => {
  it("decodes standard and URL-safe base64, with or without padding", () => {
    expect([...urlBase64ToUint8Array("AQAB")]).toEqual([1, 0, 1])
    expect([...urlBase64ToUint8Array("-_8")]).toEqual([251, 255])
  })
})

describe("iosVersion", () => {
  it("reads iPhone OS and the iPad desktop-mode Safari version", () => {
    expect(iosVersion(IPHONE_17)).toEqual([17, 2])
    expect(iosVersion(IPAD_DESKTOP_16_4)).toEqual([16, 4])
    expect(iosVersion("no version here")).toBeNull()
  })
})

describe("reminders.state", () => {
  it("iPhone Safari outside the home-screen app needs the install first (no PushManager there)", async () => {
    const { api } = setup({
      platform: "ios",
      standalone: false,
      userAgent: IPHONE_17,
      push: null,
    })

    expect(await api.state()).toBe("needs-install")
  })

  it("an installed iPhone app on iOS 16.4+ is judged like any browser", async () => {
    const { api } = setup({
      platform: "ios",
      standalone: true,
      userAgent: IPHONE_17,
    })

    expect(await api.state()).toBe("off")
  })

  it("iOS older than 16.4 is unsupported even installed — installing would not help", async () => {
    expect(
      await setup({ platform: "ios", userAgent: IPHONE_16_3 }).api.state(),
    ).toBe("unsupported")
    expect(
      await setup({
        platform: "ios",
        standalone: true,
        userAgent: IPHONE_16_3,
      }).api.state(),
    ).toBe("unsupported")
  })

  it("is unsupported without Push APIs or without a VAPID key (the build had none)", async () => {
    expect(await setup({ push: null }).api.state()).toBe("unsupported")
    expect(await setup({ key: null }).api.state()).toBe("unsupported")
    expect(await setup({ key: "" }).api.state()).toBe("unsupported")
    expect(
      await setup({
        key: null,
        platform: "ios",
        userAgent: IPHONE_17,
      }).api.state(),
    ).toBe("unsupported")
  })

  it("is denied when the browser permission is denied", async () => {
    const { push } = fakeBrowser({ permission: "denied" })

    expect(await setup({ push }).api.state()).toBe("denied")
  })

  it("is on only with granted permission AND a live subscription", async () => {
    expect(
      await setup({
        push: fakeBrowser({ permission: "granted", subscribed: true }).push,
      }).api.state(),
    ).toBe("on")
    expect(
      await setup({
        push: fakeBrowser({ permission: "granted" }).push,
      }).api.state(),
    ).toBe("off")
    expect(
      await setup({
        push: fakeBrowser({ permission: "default", subscribed: true }).push,
      }).api.state(),
    ).toBe("off")
  })

  it("reads as off (not a rejection) when the registration cannot be asked", async () => {
    const { push } = fakeBrowser({ permission: "granted" })
    push.getSubscription.mockRejectedValue(new Error("InvalidStateError"))

    expect(await setup({ push }).api.state()).toBe("off")
  })
})

describe("reminders.enable", () => {
  it("asks permission, subscribes with the VAPID key, then PUTs the subscription", async () => {
    const { api, deps, browser, marker } = setup()

    expect(await api.enable()).toBe("on")

    expect(browser.push.requestPermission).toHaveBeenCalledOnce()
    expect(browser.push.subscribe).toHaveBeenCalledWith(
      new Uint8Array([1, 0, 1]),
    )
    expect(deps.put).toHaveBeenCalledWith({
      subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        expirationTime: null,
        keys: { p256dh: "p256dh-key", auth: "auth-secret" },
      },
      timezone: "America/New_York",
      locale: "fr",
      hour: 16,
      minute: 30,
    })
    expect(await api.state()).toBe("on")
    expect(marker()).toBe("student-a")
  })

  it("asks for permission synchronously, inside the tap (Safari drops the prompt otherwise)", () => {
    const { api, browser } = setup()

    void api.enable()

    expect(browser.push.requestPermission).toHaveBeenCalledOnce()
  })

  it("does not prompt again when permission is already granted", async () => {
    const { push } = fakeBrowser({ permission: "granted" })
    const { api } = setup({ push })

    expect(await api.enable()).toBe("on")
    expect(push.requestPermission).not.toHaveBeenCalled()
  })

  it("returns denied without subscribing when the student refuses the browser prompt", async () => {
    const { push } = fakeBrowser({ prompt: "denied" })
    const { api, deps } = setup({ push })

    expect(await api.enable()).toBe("denied")
    expect(push.subscribe).not.toHaveBeenCalled()
    expect(deps.put).not.toHaveBeenCalled()
    expect(await api.state()).toBe("denied")
  })

  it("stays off when the student dismisses the browser prompt without choosing", async () => {
    const { push } = fakeBrowser({ prompt: "default" })
    const { api } = setup({ push })

    expect(await api.enable()).toBe("off")
    expect(push.subscribe).not.toHaveBeenCalled()
  })

  it.each([
    ["needs-install", { platform: "ios", userAgent: IPHONE_17 }],
    ["unsupported", { key: null }],
    ["unsupported", { push: null }],
  ] as const)(
    "does not prompt when the state is %s",
    async (expected, over) => {
      const browser = fakeBrowser()
      const { api } = setup({ push: browser.push, ...over })

      expect(await api.enable()).toBe(expected)
      expect(browser.push.requestPermission).not.toHaveBeenCalled()
    },
  )

  it("turns a permission-API error into a ReminderError, with nothing subscribed", async () => {
    const { push } = fakeBrowser()
    push.requestPermission.mockRejectedValue(new TypeError("not allowed"))
    const { api } = setup({ push })

    await expect(api.enable()).rejects.toMatchObject({ reason: "failed" })
    expect(push.subscribe).not.toHaveBeenCalled()
  })

  it("turns a pushManager.subscribe failure into a ReminderError and leaves the switch off", async () => {
    const { push } = fakeBrowser()
    push.subscribe.mockRejectedValue(new DOMException("abort", "AbortError"))
    const { api, deps } = setup({ push })

    await expect(api.enable()).rejects.toMatchObject({ reason: "failed" })
    expect(deps.put).not.toHaveBeenCalled()
    expect(await api.state()).toBe("off")
  })

  it.each([
    ["browser-refused", problem(400, "invalid_body")],
    ["not-configured", problem(503, "reminders_not_configured")],
    ["conflict", problem(409, "reminder_endpoint_conflict")],
    ["failed", problem(500, "internal")],
    ["offline", new TypeError("Failed to fetch")],
    ["failed", new SyntaxError("Unexpected token <")],
  ] as const)(
    "rolls the browser subscription back and reports %s when the PUT fails",
    async (reason, error) => {
      const { api, browser, marker } = setup({
        put: vi.fn().mockRejectedValue(error),
      })

      const outcome = api.enable()

      await expect(outcome).rejects.toBeInstanceOf(ReminderError)
      await expect(outcome).rejects.toMatchObject({ reason })
      expect(browser.live()).toBeNull()
      expect(marker()).toBeNull()
    },
  )

  it("after the server's push-host allow-list refused this browser, it stays unsupported", async () => {
    const { api, browser } = setup({
      put: vi.fn().mockRejectedValue(problem(400, "invalid_body")),
    })

    await expect(api.enable()).rejects.toMatchObject({
      reason: "browser-refused",
    })

    expect(await api.state()).toBe("unsupported")
    expect(await api.enable()).toBe("unsupported")
    expect(browser.push.subscribe).toHaveBeenCalledTimes(1)
  })

  it("a 503 (server has no VAPID keys) leaves the switch off, not unsupported", async () => {
    const { api } = setup({
      put: vi.fn().mockRejectedValue(problem(503, "reminders_not_configured")),
    })

    await expect(api.enable()).rejects.toMatchObject({
      reason: "not-configured",
    })
    expect(await api.state()).toBe("off")
  })

  it("still rejects (and does not hang) when the rollback unsubscribe itself fails", async () => {
    const subscription = fakeSubscription()
    subscription.unsubscribe.mockRejectedValue(new Error("gone"))
    const { push } = fakeBrowser()
    push.subscribe.mockResolvedValue(subscription)
    const { api } = setup({
      push,
      put: vi.fn().mockRejectedValue(new Error("x")),
    })

    await expect(api.enable()).rejects.toMatchObject({ reason: "failed" })
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
  })

  it("rolls back and throws on a subscription missing its keys", async () => {
    const subscription = fakeSubscription({ keys: undefined })
    const { push } = fakeBrowser()
    push.subscribe.mockResolvedValue(subscription)
    const { api, deps } = setup({ push })

    await expect(api.enable()).rejects.toMatchObject({ reason: "failed" })
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
    expect(deps.put).not.toHaveBeenCalled()
  })
})

describe("reminders.disable", () => {
  it("tells the server, unsubscribes the browser and reads back off", async () => {
    const browser = fakeBrowser({ permission: "granted", subscribed: true })
    const { api, deps, marker } = setup({
      push: browser.push,
      marker: "student-a",
    })

    expect(await api.disable()).toBe("off")
    expect(deps.remove).toHaveBeenCalledOnce()
    expect(browser.live()).toBeNull()
    expect(marker()).toBeNull()
  })

  it("still unsubscribes the browser when the server call fails (offline)", async () => {
    const browser = fakeBrowser({ permission: "granted", subscribed: true })
    const { api } = setup({
      push: browser.push,
      remove: vi.fn().mockRejectedValue(new TypeError("offline")),
    })

    expect(await api.disable()).toBe("off")
    expect(browser.live()).toBeNull()
  })

  it("reports on (truthfully) when the browser refused to unsubscribe", async () => {
    const browser = fakeBrowser({ permission: "granted", subscribed: true })
    browser.live()?.unsubscribe.mockRejectedValue(new Error("nope"))
    const { api } = setup({ push: browser.push })

    expect(await api.disable()).toBe("on")
  })
})

describe("reminders sign-out step", () => {
  it("captures the token synchronously and drops this browser's subscription", async () => {
    const browser = fakeBrowser({ permission: "granted", subscribed: true })
    const { api, deps, marker } = setup({
      push: browser.push,
      marker: "student-a",
    })

    const pending = api.purgeStep()

    expect(deps.removeWithToken).toHaveBeenCalledWith("bearer-a")
    await pending
    expect(browser.live()).toBeNull()
    expect(marker()).toBeNull()
  })

  it("sends no DELETE when this browser never turned reminders on (the student's phone keeps its reminders)", async () => {
    const { api, deps } = setup({ marker: null })

    await api.purgeStep()

    expect(deps.removeWithToken).not.toHaveBeenCalled()
  })

  it("sends no DELETE after a DIFFERENT student signed in, but still drops the old subscription", async () => {
    const browser = fakeBrowser({ permission: "granted", subscribed: true })
    const { api, deps } = setup({
      push: browser.push,
      marker: "student-a",
      student: "student-b",
      token: "bearer-b",
    })

    await api.purgeStep()

    expect(deps.removeWithToken).not.toHaveBeenCalled()
    expect(browser.live()).toBeNull()
  })

  it("never rejects, even when the browser cannot be asked", async () => {
    const { push } = fakeBrowser()
    push.getSubscription.mockRejectedValue(new Error("boom"))

    await expect(setup({ push }).api.purgeStep()).resolves.toBeUndefined()
    await expect(setup({ push: null }).api.purgeStep()).resolves.toBeUndefined()
  })
})

describe("unsubscribeOnSignOut (browser-wired)", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    tokenStore.set("access_token", "bearer-xyz")
    localStorage.setItem("pp.last-student", "student-a")
    localStorage.setItem("pp.reminders.owner", "student-a")
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    tokenStore.clear()
    localStorage.clear()
  })

  it("sends a keepalive DELETE with the token it captured, even if the token is cleared right after", async () => {
    const pending = unsubscribeOnSignOut()
    tokenStore.clear()
    await pending

    expect(fetchMock).toHaveBeenCalledWith("/api/me/reminders", {
      method: "DELETE",
      headers: { authorization: "Bearer bearer-xyz" },
      keepalive: true,
    })
    expect(localStorage.getItem("pp.reminders.owner")).toBeNull()
  })

  it("sends nothing and still resolves when there is no session", async () => {
    tokenStore.clear()

    await expect(unsubscribeOnSignOut()).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
