import { vi } from "vitest"
import type { PushEnvironment } from "../lib/reminders.js"

export function fakeSubscription(
  overrides: Partial<PushSubscriptionJSON> = {},
) {
  const unsubscribe = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)

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
 * A browser in memory: Notification.permission, the permission prompt and the
 * worker's PushManager, with a real subscribe → getSubscription → unsubscribe
 * lifecycle, so "the switch is truthful" is checked against what the browser
 * would really report afterwards.
 */
export function fakePushBrowser(
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

  return {
    push,
    live: () => live,
    /** The student changes the permission in the browser's settings. */
    setPermission: (next: NotificationPermission) => {
      permission = next
    },
  }
}
