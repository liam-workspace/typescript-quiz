import { readFileSync } from "node:fs"
import { join } from "node:path"
import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"

const source = readFileSync(join(process.cwd(), "public/push-sw.js"), "utf8")

interface ShownNotification {
  readonly title: string
  readonly options: {
    readonly body?: string
    readonly tag?: string
    readonly renotify?: boolean
    readonly icon?: string
    readonly data?: { readonly url: string }
  }
}

interface FakeWindow {
  readonly url: string
  focus(): Promise<unknown>
  navigate?(url: string): Promise<unknown>
}

type Listener = (event: unknown) => void

/** Runs the real file in a sandbox whose `self` is a fake service worker. */
function loadWorker(windows: FakeWindow[] = []) {
  const listeners = new Map<string, Listener>()
  const shown: ShownNotification[] = []
  const opened: string[] = []
  const matchAllOptions: unknown[] = []
  const self = {
    location: { origin: "https://quiz.example.test" },
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, listener)
    },
    registration: {
      showNotification: (
        title: string,
        options: ShownNotification["options"],
      ) => {
        // A fixed tag REPLACES the notification with the same tag, which is
        // what a browser does; modelled so duplicates are observable.
        const same = shown.findIndex((item) => item.options.tag === options.tag)

        if (options.tag && same !== -1) {
          shown.splice(same, 1)
        }

        shown.push({ title, options })

        return Promise.resolve()
      },
    },
    clients: {
      matchAll: (options: unknown) => {
        matchAllOptions.push(options)

        return Promise.resolve(windows)
      },
      openWindow: (url: string) => {
        opened.push(url)

        return Promise.resolve(null)
      },
    },
  }

  runInNewContext(source, { self, URL })

  async function dispatch(type: string, event: object): Promise<void> {
    const waits: Array<Promise<unknown>> = []

    listeners.get(type)?.({
      ...event,
      waitUntil: (promise: Promise<unknown>) => {
        waits.push(promise)
      },
    })
    await Promise.all(waits)
  }

  function push(data: unknown, options: { parseFails?: boolean } = {}) {
    return dispatch("push", {
      data:
        data === null
          ? null
          : {
              json: () => {
                if (options.parseFails) {
                  throw new SyntaxError("bad json")
                }

                return data
              },
            },
    })
  }

  async function click(url?: string): Promise<{ closed: boolean }> {
    const state = { closed: false }

    await dispatch("notificationclick", {
      notification: {
        close: () => {
          state.closed = true
        },
        data: url === undefined ? undefined : { url },
      },
    })

    return state
  }

  return { shown, opened, matchAllOptions, push, click, listeners }
}

describe("push-sw.js", () => {
  it("registers only the push and notificationclick handlers", () => {
    expect([...loadWorker().listeners.keys()].sort()).toEqual([
      "notificationclick",
      "push",
    ])
  })

  it("shows the pushed title and body with the FIXED tag and renotify off", async () => {
    const worker = loadWorker()

    await worker.push({
      title: "Primary Practice",
      body: "Time for a little practice 🎧",
      url: "/",
    })

    expect(worker.shown).toHaveLength(1)
    expect(worker.shown[0].title).toBe("Primary Practice")
    expect(worker.shown[0].options).toMatchObject({
      body: "Time for a little practice 🎧",
      tag: "practice-reminder",
      renotify: false,
      icon: "/pwa-192x192.png",
      data: { url: "/" },
    })
  })

  it("a duplicate delivery (server retry after an ambiguous timeout) replaces the first instead of stacking", async () => {
    const worker = loadWorker()
    const message = { title: "Primary Practice", body: "b", url: "/" }

    await worker.push(message)
    await worker.push(message)

    expect(worker.shown).toHaveLength(1)
    expect(worker.shown[0].options.tag).toBe("practice-reminder")
  })

  it.each([
    ["the payload is not JSON", { parseFails: true }, {}],
    ["there is no payload at all", {}, null],
    ["the payload is not an object", {}, "just text"],
  ] as const)(
    "still shows a notification (userVisibleOnly requires one per push) when %s",
    async (_name, options, data) => {
      const worker = loadWorker()

      await worker.push(data, options)

      expect(worker.shown).toHaveLength(1)
      expect(worker.shown[0].title).toBe("Primary Practice")
      expect(worker.shown[0].options.tag).toBe("practice-reminder")
    },
  )

  it.each([
    "https://evil.example/x",
    "//evil.example/x",
    "/\\evil.example",
    // Built at runtime so no-script-url does not flag the fixture itself.
    ["javascript", "alert(1)"].join(":"),
    42,
  ])("only ever opens an in-app path: %s becomes /", async (url) => {
    const worker = loadWorker()

    await worker.push({ title: "t", body: "b", url })

    expect(worker.shown[0].options.data?.url).toBe("/")
  })

  it("closes the notification and focuses an open app window", async () => {
    let focused = false
    const worker = loadWorker([
      {
        url: "https://quiz.example.test/history",
        focus: () => {
          focused = true

          return Promise.resolve()
        },
      },
    ])

    const { closed } = await worker.click("/")

    expect(closed).toBe(true)
    expect(focused).toBe(true)
    expect(worker.opened).toEqual([])
    expect(worker.matchAllOptions).toEqual([
      { type: "window", includeUncontrolled: true },
    ])
  })

  it("opens the app at / when no window is open", async () => {
    const worker = loadWorker([])

    await worker.click("/")

    expect(worker.opened).toEqual(["/"])
  })

  it("falls back to / when the notification carries no or unsafe data", async () => {
    const worker = loadWorker([])

    await worker.click(undefined)
    await worker.click("https://evil.example/")

    expect(worker.opened).toEqual(["/", "/"])
  })
})
