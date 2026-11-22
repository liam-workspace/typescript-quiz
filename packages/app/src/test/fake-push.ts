import { vi } from "vitest"
import type { PushEnvironment } from "../lib/reminders.js"

/** A promise that never settles: a call the page never sees the end of. */
export function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {
    // Never settles, on purpose.
  })
}

/** The bytes of the test VAPID key "AQAB". */
export const TEST_SERVER_KEY = [1, 0, 1] as const

/** An unsigned JWT-shaped token whose payload carries `sub` (tests only). */
export function fakeJwt(sub: string): string {
  const payload = btoa(JSON.stringify({ sub }))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "")

  return `eyJhbGciOiJub25lIn0.${payload}.sig`
}

export function fakeSubscription(
  overrides: Partial<PushSubscriptionJSON> = {},
  /** `null` = a subscription whose options are missing. */
  serverKey: readonly number[] | null = TEST_SERVER_KEY,
) {
  const unsubscribe = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)

  return {
    unsubscribe,
    options:
      serverKey === null
        ? undefined
        : {
            userVisibleOnly: true,
            applicationServerKey: new Uint8Array(serverKey).buffer,
          },
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
    /** The key the pre-existing subscription was made with. */
    subscribedKey?: readonly number[] | null
  } = {},
) {
  let permission: NotificationPermission = initial.permission ?? "default"
  let live: ReturnType<typeof fakeSubscription> | null = null
  const issue = (serverKey: readonly number[] | null = TEST_SERVER_KEY) => {
    const subscription = fakeSubscription({}, serverKey)

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
    issue(initial.subscribedKey)
  }

  const push = {
    permission: vi.fn(() => permission),
    requestPermission: vi.fn(() => {
      permission = initial.prompt ?? "granted"

      return Promise.resolve(permission)
    }),
    getSubscription: vi.fn(() => Promise.resolve(live)),
    // Like PushManager: the same key returns the live subscription, another
    // key while one is live is an InvalidStateError.
    subscribe: vi.fn((key: Uint8Array<ArrayBuffer>) => {
      if (live === null) {
        return Promise.resolve(issue([...key]))
      }

      const options = live.options as PushSubscriptionOptions | undefined
      const current = options?.applicationServerKey
      const same =
        current instanceof ArrayBuffer &&
        new Uint8Array(current).join() === [...key].join()

      return same
        ? Promise.resolve(live)
        : Promise.reject(new DOMException("key mismatch", "InvalidStateError"))
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
