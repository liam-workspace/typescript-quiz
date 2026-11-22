import { createECDH, randomBytes } from "node:crypto"
import { EventEmitter } from "node:events"
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http"
import https from "node:https"
import { generateVAPIDKeys } from "web-push"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PushConfig } from "../src/config.js"
import {
  PUSH_DEADLINE_MS,
  PUSH_SOCKET_TIMEOUT_MS,
  WebPushSender,
  type PushTarget,
} from "../src/reminders/push-sender.js"

const vapid = generateVAPIDKeys()
const CONFIG: PushConfig = {
  publicKey: vapid.publicKey,
  privateKey: vapid.privateKey,
  subject: "mailto:ops@example.test",
}
const TARGET: PushTarget = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc?x=1",
  p256dh: createECDH("prime256v1").generateKeys().toString("base64url"),
  auth: randomBytes(16).toString("base64url"),
}
const MESSAGE = { title: "Primary Practice", body: "Hi", url: "/" }

type Responder = (request: FakeRequest) => void

/** Just enough of `ClientRequest` for web-push 4's `sendNotification`. */
class FakeRequest extends EventEmitter {
  destroyed = false
  readonly chunks: unknown[] = []

  constructor(
    readonly options: RequestOptions,
    private readonly onResponse: (response: IncomingMessage) => void,
    private readonly responder: Responder,
  ) {
    super()
  }

  write(chunk: unknown): boolean {
    this.chunks.push(chunk)

    return true
  }

  end(): this {
    this.responder(this)

    return this
  }

  destroy(error?: Error): this {
    this.destroyed = true
    this.emit("error", error ?? new Error("destroyed"))

    return this
  }

  respond(statusCode: number, headers: Record<string, string> = {}): void {
    const response = Object.assign(new EventEmitter(), {
      statusCode,
      headers,
    })

    this.onResponse(response as unknown as IncomingMessage)
    response.emit("end")
  }
}

describe("WebPushSender (real web-push 4, https.request intercepted)", () => {
  const requests: FakeRequest[] = []
  let responder: Responder = (request) => {
    request.respond(201)
  }

  beforeEach(() => {
    requests.length = 0
    vi.spyOn(https, "request").mockImplementation(((
      options: RequestOptions,
      onResponse: (response: IncomingMessage) => void,
    ) => {
      const request = new FakeRequest(options, onResponse, responder)

      requests.push(request)

      return request as unknown as ClientRequest
    }) as unknown as typeof https.request)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    responder = (request) => {
      request.respond(201)
    }
  })

  it("sends one plain https.request whose host comes from WHATWG URL, with a socket timeout and its own agent, no proxy", async () => {
    const outcome = await new WebPushSender(CONFIG).send(TARGET, MESSAGE)

    expect(outcome).toEqual({ kind: "sent" })
    expect(requests).toHaveLength(1)

    const [{ options }] = requests
    const expected = new URL(TARGET.endpoint)

    // The installed web-push 4 (src/web-push-lib.js, sendNotification) builds the request
    // from `new URL(endpoint)`: hostname/port/pathname+search. 3.x used the
    // legacy url.parse; this pins the WHATWG reading for the installed copy.
    expect(options.hostname).toBe(expected.hostname)
    expect(options.port).toBe("")
    expect(options.path).toBe(`${expected.pathname}${expected.search}`)
    expect(options.method).toBe("POST")
    expect(options.timeout).toBe(PUSH_SOCKET_TIMEOUT_MS)
    // A fresh plain https.Agent per send (never an HttpsProxyAgent, never
    // the global agent), so `destroy()` at the deadline kills only this
    // request's socket.
    expect(options.agent).toBeInstanceOf(https.Agent)
    expect(options.agent).not.toBe(https.globalAgent)
    expect(options.agent?.constructor).toBe(https.Agent)
    // "normal", not "low": RFC 8030 "low" means "on power and Wi-Fi" and FCM
    // holds it behind Doze, so a 16:30 reminder could arrive hours late. The
    // fixed Topic makes a retry replace a still-queued copy.
    expect(options.headers).toMatchObject({
      TTL: 21_600,
      Urgency: "normal",
      Topic: "practice-reminder",
    })
  })

  it("never follows a redirect: a 3xx is a transient failure after exactly one request", async () => {
    responder = (request) => {
      request.respond(302, { location: "https://evil.example.test/" })
    }

    const outcome = await new WebPushSender(CONFIG).send(TARGET, MESSAGE)

    expect(outcome).toEqual({ kind: "failed", statusCode: 302 })
    expect(requests).toHaveLength(1)
  })

  it.each([404, 410])(
    "maps %i to gone (the subscription is dead)",
    async (statusCode) => {
      responder = (request) => {
        request.respond(statusCode)
      }

      expect(await new WebPushSender(CONFIG).send(TARGET, MESSAGE)).toEqual({
        kind: "gone",
      })
    },
  )

  it.each([400, 401, 403, 413])(
    "maps %i to rejected (deterministic: retrying the same request cannot succeed)",
    async (statusCode) => {
      responder = (request) => {
        request.respond(statusCode)
      }

      expect(await new WebPushSender(CONFIG).send(TARGET, MESSAGE)).toEqual({
        kind: "rejected",
        statusCode,
      })
    },
  )

  it.each([429, 500, 503])(
    "maps %i to a transient failure",
    async (statusCode) => {
      responder = (request) => {
        request.respond(statusCode)
      }

      expect(await new WebPushSender(CONFIG).send(TARGET, MESSAGE)).toEqual({
        kind: "failed",
        statusCode,
      })
    },
  )

  it("maps a socket timeout to a transient failure", async () => {
    responder = (request) => {
      request.emit("timeout")
    }

    expect(await new WebPushSender(CONFIG).send(TARGET, MESSAGE)).toEqual({
      kind: "failed",
      statusCode: null,
    })
    expect(requests[0].destroyed).toBe(true)
  })

  it("maps a network error to a transient failure", async () => {
    responder = (request) => {
      request.emit("error", new Error("ECONNRESET"))
    }

    expect(await new WebPushSender(CONFIG).send(TARGET, MESSAGE)).toEqual({
      kind: "failed",
      statusCode: null,
    })
  })

  it("gives up at the overall deadline when the push service never answers", async () => {
    vi.useFakeTimers()
    responder = () => {
      // Silence: no response, no error, no timeout event.
    }

    const pending = new WebPushSender(CONFIG).send(TARGET, MESSAGE)

    await vi.advanceTimersByTimeAsync(PUSH_DEADLINE_MS)

    expect(await pending).toEqual({ kind: "failed", statusCode: null })
    expect(vi.getTimerCount()).toBe(0)
  })

  it("clears its deadline timer after a normal send", async () => {
    vi.useFakeTimers()

    await new WebPushSender(CONFIG).send(TARGET, MESSAGE)

    expect(vi.getTimerCount()).toBe(0)
  })

  it("encrypts the payload: the request body never carries the message in clear", async () => {
    await new WebPushSender(CONFIG).send(TARGET, {
      ...MESSAGE,
      body: "plain-text-marker",
    })

    const body = Buffer.concat(
      requests[0].chunks.map((chunk) => Buffer.from(chunk as Buffer)),
    )

    expect(body.includes("plain-text-marker")).toBe(false)
  })
})
