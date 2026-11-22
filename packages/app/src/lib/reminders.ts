import i18next from "i18next"
import { ApiError, apiFetch } from "./api-client.js"
import { currentAccessToken } from "./auth.js"
import { lastSignedInStudent } from "./pwa/purge.js"
import { pwaStore, type PwaPlatform } from "./pwa/pwa-store.js"

export type ReminderState =
  | "off"
  | "on"
  | "denied"
  | "needs-install"
  | "unsupported"

/** The prototype's fixed time: "Daily at 4:30 pm". */
export const REMINDER_HOUR = 16

export const REMINDER_MINUTE = 30

/**
 * Why a turn-on failed, so the Profile row can say something specific:
 * - `browser-refused`: the server's push-host allow-list refused this
 *   browser's push service (400) — this browser can't receive reminders;
 * - `not-configured`: the server has no VAPID keys (503);
 * - `conflict`: another sign-in registered this device at the same time (409);
 * - `offline`: the request never reached the server;
 * - `failed`: anything else (permission API error, subscribe failure, 5xx).
 */
export type ReminderFailure =
  | "browser-refused"
  | "not-configured"
  | "conflict"
  | "offline"
  | "failed"

export class ReminderError extends Error {
  public readonly reason: ReminderFailure

  public constructor(reason: ReminderFailure, options?: ErrorOptions) {
    super(`reminders_${reason}`, options)
    this.reason = reason
  }
}

export interface ReminderPut {
  readonly subscription: {
    readonly endpoint: string
    readonly expirationTime: number | null
    readonly keys: { readonly p256dh: string; readonly auth: string }
  }
  readonly timezone: string
  readonly locale: string
  readonly hour: number
  readonly minute: number
}

export interface PushEnvironment {
  /** Synchronous on purpose: see `enable()`. */
  permission(): NotificationPermission
  requestPermission(): Promise<NotificationPermission>
  getSubscription(): Promise<PushSubscription | null>
  subscribe(
    applicationServerKey: Uint8Array<ArrayBuffer>,
  ): Promise<PushSubscription>
}

/**
 * "This browser subscribed on behalf of student X." Written on a successful
 * turn-on, so a sign-out only tells the server to drop the subscription when
 * THIS browser holds it: the server keeps one subscription per student, and
 * a blind DELETE from a tablet the student never enabled would silently stop
 * the reminders on their phone.
 */
export interface SubscriptionMarker {
  get(): string | null
  set(owner: string | null): void
}

export interface RemindersDeps {
  snapshot(): {
    readonly platform: PwaPlatform
    readonly standalone: boolean
    readonly userAgent: string
  }
  vapidKey(): string | null
  /** Null in a browser without service workers, Push or Notifications. */
  push(): PushEnvironment | null
  put(body: ReminderPut): Promise<void>
  remove(): Promise<void>
  timezone(): string
  locale(): string
  marker: SubscriptionMarker
  /** The signed-in student this browser last saw (`pp.last-student`). */
  student(): string | null
  /** Synchronous read of the bearer token, for the sign-out step. */
  token(): string | null
  /** Fire-and-forget server DELETE that survives the page navigating away. */
  removeWithToken(token: string): void
}

export interface RemindersApi {
  state(): Promise<ReminderState>
  enable(): Promise<ReminderState>
  disable(): Promise<ReminderState>
}

export interface BrowserReminders extends RemindersApi {
  /** The sign-out purge step; must start synchronously (purge.ts). */
  purgeStep(): Promise<void>
}

export function urlBase64ToUint8Array(
  base64Url: string,
): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/gu, "+").replace(/_/gu, "/")
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index)
  }

  return bytes
}

/**
 * The iOS/iPadOS version a user agent reports, or null when it does not say.
 * iPhone UAs carry `OS 17_2`; iPadOS 13+ poses as a Mac, so Safari's
 * `Version/17.2` is the fallback there.
 */
export function iosVersion(
  userAgent: string,
): readonly [number, number] | null {
  const match =
    /\bOS (\d+)[._](\d+)/u.exec(userAgent) ??
    /\bVersion\/(\d+)\.(\d+)/u.exec(userAgent)

  return match ? [Number(match[1]), Number(match[2])] : null
}

/** Web Push reached iOS in 16.4, and only for home-screen apps. */
function iosTooOld(userAgent: string): boolean {
  const version = iosVersion(userAgent)

  return (
    version !== null &&
    (version[0] < 16 || (version[0] === 16 && version[1] < 4))
  )
}

const FAILURE_BY_STATUS: Partial<Record<number, ReminderFailure>> = {
  // The client builds the whole body itself, so a 400 from PUT means the
  // server's push-host allow-list refused this browser's endpoint.
  400: "browser-refused",
  409: "conflict",
  503: "not-configured",
}

function classify(error: unknown): ReminderFailure {
  if (error instanceof ApiError) {
    return FAILURE_BY_STATUS[error.problem.status] ?? "failed"
  }

  return error instanceof TypeError ? "offline" : "failed"
}

async function dropSubscription(
  subscription: PushSubscription | null,
): Promise<void> {
  try {
    await subscription?.unsubscribe()
  } catch {
    // Nothing more to do from here; state() re-reads the truth afterwards.
  }
}

export function createReminders(deps: RemindersDeps): BrowserReminders {
  // The server's allow-list refused this browser's push service. Kept for
  // this page's lifetime so the row stays "unsupported" instead of offering
  // a switch that can only fail the same way again.
  let refusedByServer = false

  /** Everything that can be decided without awaiting. */
  function gate(): ReminderState | PushEnvironment {
    const { platform, standalone, userAgent } = deps.snapshot()

    if (!deps.vapidKey() || refusedByServer) {
      return "unsupported"
    }

    if (platform === "ios") {
      if (iosTooOld(userAgent)) {
        return "unsupported"
      }

      // Checked before Push support: a Safari tab on iOS has no PushManager
      // at all, and "unsupported" would be the wrong thing to tell someone
      // who only needs to add the app to their home screen.
      if (!standalone) {
        return "needs-install"
      }
    }

    const push = deps.push()

    if (!push) {
      return "unsupported"
    }

    return push.permission() === "denied" ? "denied" : push
  }

  async function currentSubscription(
    push: PushEnvironment,
  ): Promise<PushSubscription | null> {
    try {
      return await push.getSubscription()
    } catch {
      return null
    }
  }

  async function state(): Promise<ReminderState> {
    const push = gate()

    if (typeof push === "string") {
      return push
    }

    const subscription = await currentSubscription(push)

    return subscription !== null && push.permission() === "granted"
      ? "on"
      : "off"
  }

  async function enable(): Promise<ReminderState> {
    const push = gate()
    const key = deps.vapidKey()

    if (typeof push === "string" || !key) {
      return typeof push === "string" ? push : "unsupported"
    }

    // No await before this line: Safari only shows the permission prompt
    // while the tap that asked for it still counts as a user gesture.
    const permission = await (
      push.permission() === "granted"
        ? Promise.resolve<NotificationPermission>("granted")
        : push.requestPermission()
    ).catch((error: unknown) => {
      throw new ReminderError("failed", { cause: error })
    })

    if (permission === "denied") {
      return "denied"
    }

    if (permission !== "granted") {
      return "off"
    }

    const subscription = await push
      .subscribe(urlBase64ToUint8Array(key))
      .catch((error: unknown) => {
        throw new ReminderError("failed", { cause: error })
      })

    const { endpoint, expirationTime, keys } = subscription.toJSON()

    if (!endpoint || !keys?.p256dh || !keys.auth) {
      await dropSubscription(subscription)

      throw new ReminderError("failed")
    }

    try {
      await deps.put({
        subscription: {
          endpoint,
          expirationTime: expirationTime ?? null,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
        },
        timezone: deps.timezone(),
        locale: deps.locale(),
        hour: REMINDER_HOUR,
        minute: REMINDER_MINUTE,
      })
    } catch (error) {
      // The server never stored this subscription. Leaving the browser one
      // in place would show the switch ON while nothing is ever sent.
      await dropSubscription(subscription)

      const reason = classify(error)

      if (reason === "browser-refused") {
        refusedByServer = true
      }

      throw new ReminderError(reason, { cause: error })
    }

    deps.marker.set(deps.student() ?? "")

    return "on"
  }

  async function disable(): Promise<ReminderState> {
    const push = deps.push()
    const subscription = push ? await currentSubscription(push) : null

    try {
      await deps.remove()
    } catch {
      // Offline or a server error: the browser-side unsubscribe below still
      // stops delivery, and the server drops the row on the push service's
      // next 404/410 for it.
    }

    await dropSubscription(subscription)
    deps.marker.set(null)

    return state()
  }

  function purgeStep(): Promise<void> {
    // Synchronous part first: signOut() clears the token right after the
    // purge starts. Only the student who subscribed THIS browser has a
    // server row to drop here; after a different student signs in
    // (purgeIfSubjectChanged), the marker names the previous one, and the
    // new token must not delete the new student's other device.
    const owner = deps.marker.get()
    const token = deps.token()

    if (owner !== null && token !== null && owner === (deps.student() ?? "")) {
      deps.removeWithToken(token)
    }

    deps.marker.set(null)

    const push = deps.push()

    return push
      ? currentSubscription(push).then(dropSubscription)
      : Promise.resolve()
  }

  return { state, enable, disable, purgeStep }
}

const LOCALES = ["de", "en", "es", "fr", "it", "ja"]
const MARKER_KEY = "pp.reminders.owner"
const READY_TIMEOUT_MS = 10_000

function currentLocale(): string {
  const [base] = (i18next.resolvedLanguage ?? i18next.language).split("-")

  return LOCALES.includes(base) ? base : "en"
}

function browserVapidKey(): string | null {
  // A LITERAL `import.meta.env.KEY` (see auth.ts readAuthConfig).
  const raw = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

  // `__VITE_VAPID_PUBLIC_KEY__` is the Docker placeholder docker-entrypoint.sh
  // swaps for the real key (or "") at container start.
  return raw && !raw.startsWith("__VITE_") ? raw : null
}

function rejectAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    globalThis.setTimeout(() => {
      reject(new Error("service_worker_not_ready"))
    }, ms)
  })
}

function browserPush(): PushEnvironment | null {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    typeof globalThis.PushManager === "undefined" ||
    typeof globalThis.Notification === "undefined"
  ) {
    return null
  }

  return {
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    getSubscription: async () => {
      const registration = await navigator.serviceWorker.getRegistration()

      return (await registration?.pushManager.getSubscription()) ?? null
    },
    subscribe: async (applicationServerKey) => {
      // `ready` never settles without a registered worker (a dev server, a
      // worker that failed to install); bound it so the switch cannot hang.
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        rejectAfter(READY_TIMEOUT_MS),
      ])

      return registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      })
    },
  }
}

const browserMarker: SubscriptionMarker = {
  get: () => {
    try {
      return globalThis.localStorage.getItem(MARKER_KEY)
    } catch {
      return null
    }
  },
  set: (owner) => {
    try {
      if (owner === null) {
        globalThis.localStorage.removeItem(MARKER_KEY)
      } else {
        globalThis.localStorage.setItem(MARKER_KEY, owner)
      }
    } catch {
      // Storage unavailable: the sign-out DELETE is skipped, and the browser
      // unsubscribe (which is what actually stops delivery) still runs.
    }
  },
}

const browserReminders = createReminders({
  snapshot: () => {
    const { platform, standalone } = pwaStore.getSnapshot()

    return { platform, standalone, userAgent: navigator.userAgent }
  },
  vapidKey: browserVapidKey,
  push: browserPush,
  put: async (body) => {
    await apiFetch<unknown>("/me/reminders", {
      method: "PUT",
      body: JSON.stringify(body),
    })
  },
  remove: async () => {
    await apiFetch<unknown>("/me/reminders", { method: "DELETE" })
  },
  timezone: () => new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  locale: currentLocale,
  marker: browserMarker,
  student: lastSignedInStudent,
  token: currentAccessToken,
  // A raw keepalive fetch, not apiFetch: apiFetch reads the token when it
  // sends (too late, it is cleared) and redirects to sign-in on a 401.
  removeWithToken: (token) => {
    void fetch("/api/me/reminders", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
      keepalive: true,
    }).catch(() => undefined)
  },
})

/** Browser-wired instance (spec §6). */
export const reminders: RemindersApi = browserReminders

/** Registered as a purge step in main.tsx; runs on sign-out. */
export function unsubscribeOnSignOut(): Promise<void> {
  return browserReminders.purgeStep()
}
