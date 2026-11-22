import https from "node:https"
import { sendNotification } from "web-push"
import type { PushConfig } from "../config.js"

export interface PushTarget {
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
}

export interface PushMessage {
  readonly title: string
  readonly body: string
  readonly url: string
}

export type PushOutcome =
  | { readonly kind: "sent" }
  /** 404/410: the browser unsubscribed or the subscription expired. */
  | { readonly kind: "gone" }
  /** Anything else (5xx, 429, 3xx, timeout, network): retry later. */
  | { readonly kind: "failed"; readonly statusCode: number | null }

/** The seam the scheduler tests inject a fake through. */
export interface PushSender {
  send(target: PushTarget, message: PushMessage): Promise<PushOutcome>
}

/**
 * Socket inactivity, connect phase included (`https.request`'s `timeout` is
 * armed before the socket connects).
 */
export const PUSH_SOCKET_TIMEOUT_MS = 5_000

/** The whole request, however slowly the response trickles in. */
export const PUSH_DEADLINE_MS = 10_000

/** A reminder that cannot be delivered within six hours is no reminder. */
const PUSH_TTL_SECONDS = 6 * 60 * 60

/**
 * Push services replace a still-queued message with the same topic, so a
 * retry after an ambiguous failure (a timeout after the service accepted the
 * message) replaces rather than stacks an undelivered first copy.
 */
const PUSH_TOPIC = "practice-reminder"

const DEADLINE: PushOutcome = { kind: "failed", statusCode: null }

function statusCodeOf(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const { statusCode } = error as { statusCode: unknown }

    return typeof statusCode === "number" ? statusCode : null
  }

  return null
}

/**
 * The web-push 4.0.0 adapter behind the port. What makes this safe to point at a stored,
 * student-supplied URL (on top of the scheduler's send-time allow-list):
 *
 * - Request host: web-push 4 (`src/web-push-lib.js`, `sendNotification`)
 *   takes `hostname`/`port`/`pathname + search` from WHATWG `new URL(endpoint)`
 *   -- the same parser `canonicalPushEndpoint` validated with (3.x used the
 *   legacy `url.parse`). test/push-sender.test.ts pins this.
 * - No redirects: it calls `https.request` directly, which never follows a
 *   3xx; a 3xx rejects as a WebPushError and is a transient failure here.
 *   Never pass `proxy` (that swaps in HttpsProxyAgent).
 * - Timeouts: `timeout` is the socket timeout (connect + idle); a fresh,
 *   non-keep-alive agent per send is destroyed at the overall deadline so a
 *   slow-drip response cannot pin the tick.
 * - Errors are reduced to a status code: WebPushError carries the endpoint
 *   and the response body, so nothing from it is logged or returned.
 */
export class WebPushSender implements PushSender {
  constructor(private readonly config: PushConfig) {}

  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    const agent = new https.Agent({
      keepAlive: false,
      timeout: PUSH_SOCKET_TIMEOUT_MS,
    })
    let deadline: ReturnType<typeof setTimeout> | undefined = undefined

    try {
      return await Promise.race([
        this.request(target, message, agent),
        new Promise<PushOutcome>((resolve) => {
          deadline = setTimeout(() => {
            resolve(DEADLINE)
          }, PUSH_DEADLINE_MS)
        }),
      ])
    } finally {
      clearTimeout(deadline)
      agent.destroy()
    }
  }

  private async request(
    target: PushTarget,
    message: PushMessage,
    agent: https.Agent,
  ): Promise<PushOutcome> {
    try {
      await sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        JSON.stringify(message),
        {
          TTL: PUSH_TTL_SECONDS,
          urgency: "low",
          topic: PUSH_TOPIC,
          timeout: PUSH_SOCKET_TIMEOUT_MS,
          agent,
          vapidDetails: {
            subject: this.config.subject,
            publicKey: this.config.publicKey,
            privateKey: this.config.privateKey,
          },
        },
      )

      return { kind: "sent" }
    } catch (error) {
      const statusCode = statusCodeOf(error)

      if (statusCode === 404 || statusCode === 410) {
        return { kind: "gone" }
      }

      return { kind: "failed", statusCode }
    }
  }
}
