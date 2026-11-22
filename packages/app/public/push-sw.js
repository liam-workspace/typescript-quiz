// Practice-reminder handlers, pulled into the Workbox service worker by
// `workbox.importScripts: ["push-sw.js"]` (pwa.config.ts). Plain JS on
// purpose: it is copied from public/ as-is and never bundled, so it has no
// imports. Served `Cache-Control: no-cache` (server static-headers.ts) so a
// changed handler is picked up by the next worker update check. The JSDoc
// types below exist for the type-aware lint only.

/**
 * @typedef {{ readonly title?: unknown, readonly body?: unknown, readonly url?: unknown }} Payload
 * @typedef {{ waitUntil(promise: Promise<unknown>): void }} ExtendableEventLike
 * @typedef {ExtendableEventLike & { readonly data: { json(): unknown } | null }} PushEventLike
 * @typedef {ExtendableEventLike & { readonly notification: { close(): void, readonly data?: { readonly url?: unknown } } }} ClickEventLike
 * @typedef {{
 *   addEventListener(type: "push", listener: (event: PushEventLike) => void): void
 *   addEventListener(type: "notificationclick", listener: (event: ClickEventLike) => void): void
 *   readonly registration: { showNotification(title: string, options: object): Promise<void> }
 *   readonly clients: {
 *     matchAll(options: object): Promise<ReadonlyArray<{ focus?: () => Promise<unknown> }>>
 *     openWindow(url: string): Promise<unknown>
 *   }
 * }} WorkerScope
 */

/**
 * `self` as the minimal service-worker surface this file uses.
 *
 * @returns {WorkerScope}
 */
function workerScope() {
  /** @type {unknown} */
  const scope = self

  return scope
}

const worker = workerScope()

// FIXED tag: the server may deliver a duplicate after an ambiguous timeout;
// the same tag with renotify off makes the second one silently REPLACE the
// first instead of stacking two reminders on the lock screen.
const REMINDER_TAG = "practice-reminder"
const DEFAULT_TITLE = "Primary Practice"

/**
 * In-app paths only: one leading "/", never "//" or "/\" (browsers treat both
 * as off-site). Anything else (https:, javascript:, a number) becomes "/".
 *
 * @param {unknown} value
 * @returns {string}
 */
function safeAppPath(value) {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\")
    ? value
    : "/"
}

/**
 * @param {PushEventLike} event
 * @returns {Payload}
 */
function readPayload(event) {
  try {
    /** @type {unknown} */
    const data = event.data?.json()

    return data !== null && typeof data === "object" ? data : {}
  } catch {
    return {}
  }
}

worker.addEventListener("push", function onPush(event) {
  const data = readPayload(event)
  const title =
    typeof data.title === "string" && data.title ? data.title : DEFAULT_TITLE

  // A visible notification for EVERY push (userVisibleOnly): a malformed
  // payload still shows the default title rather than nothing.
  event.waitUntil(
    worker.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      tag: REMINDER_TAG,
      renotify: false,
      data: { url: safeAppPath(data.url) },
    }),
  )
})

worker.addEventListener("notificationclick", function onClick(event) {
  event.notification.close()

  const url = safeAppPath(event.notification.data?.url)

  event.waitUntil(
    worker.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function focusOrOpen(windows) {
        for (const client of windows) {
          if (client.focus) {
            // A window that cannot be focused (e.g. closing): open one instead.
            return client.focus().catch(function openInstead() {
              return worker.clients.openWindow(url)
            })
          }
        }

        return worker.clients.openWindow(url)
      }),
  )
})
