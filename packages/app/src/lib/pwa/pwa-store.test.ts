import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPwaStore, detectPlatform } from "./pwa-store.js"

interface FakeWindow {
  navigator: { userAgent: string; maxTouchPoints: number; standalone?: boolean }
  matchMedia: (query: string) => {
    matches: boolean
    addEventListener: (type: string, fn: () => void) => void
  }
  addEventListener: (type: string, fn: (event: Event) => void) => void
  dispatch: (type: string, event?: Event) => void
}

function fakeWindow(
  options: { ua?: string; standalone?: boolean; touch?: number } = {},
): FakeWindow {
  const handlers = new Map<string, Array<(event: Event) => void>>()

  return {
    navigator: {
      userAgent: options.ua ?? "Mozilla/5.0 (Linux; Android 14) Chrome/130",
      maxTouchPoints: options.touch ?? 5,
    },
    matchMedia: () => ({
      matches: options.standalone ?? false,
      addEventListener: () => undefined,
    }),
    addEventListener: (type, fn) => {
      handlers.set(type, [...(handlers.get(type) ?? []), fn])
    },
    dispatch: (type, event = new Event(type)) => {
      for (const fn of handlers.get(type) ?? []) {
        fn(event)
      }
    },
  }
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> & {
  data: Map<string, string>
} {
  const data = new Map<string, string>()

  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

function installEvent(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt", {
    cancelable: true,
  }) as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
  }

  event.prompt = vi.fn(() => Promise.resolve())
  event.userChoice = Promise.resolve({ outcome })

  return event
}

describe("detectPlatform", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5, "ios"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", 5, "ios"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5, "ios"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0, "other"],
    ["Mozilla/5.0 (Linux; Android 14) Chrome/130", 5, "android"],
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/130", 0, "other"],
  ])("%s (touch %i) → %s", (ua, touch, expected) => {
    expect(detectPlatform(ua, touch)).toBe(expected)
  })
})

describe("pwaStore", () => {
  const storage = memoryStorage()

  beforeEach(() => {
    storage.data.clear()
  })

  it("is not standalone in a browser tab and standalone when launched from the home screen", () => {
    expect(
      createPwaStore({ win: fakeWindow(), storage }).getSnapshot().standalone,
    ).toBe(false)
    expect(
      createPwaStore({
        win: fakeWindow({ standalone: true }),
        storage,
      }).getSnapshot().standalone,
    ).toBe(true)

    const ios = fakeWindow({
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    })

    ios.navigator.standalone = true
    expect(createPwaStore({ win: ios, storage }).getSnapshot().standalone).toBe(
      true,
    )
  })

  it("captures beforeinstallprompt, prompts on demand and reports the user's choice", async () => {
    const win = fakeWindow()
    const store = createPwaStore({ win, storage })
    const event = installEvent("accepted")

    expect(store.getSnapshot().canPromptInstall).toBe(false)
    await expect(store.promptInstall()).resolves.toBe("unavailable")

    win.dispatch("beforeinstallprompt", event)
    expect(store.getSnapshot().canPromptInstall).toBe(true)
    expect(event.defaultPrevented).toBe(true)

    await expect(store.promptInstall()).resolves.toBe("accepted")
    expect(event.prompt).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().canPromptInstall).toBe(false)
  })

  it("flips to standalone on appinstalled", () => {
    const win = fakeWindow()
    const store = createPwaStore({ win, storage })

    win.dispatch("appinstalled")
    expect(store.getSnapshot().standalone).toBe(true)
  })

  it("remembers Not now across loads, and markInstalled also dismisses the card", () => {
    const first = createPwaStore({ win: fakeWindow(), storage })

    expect(first.getSnapshot().installDismissed).toBe(false)
    first.dismissInstall()
    expect(storage.data.get("pp.install.dismissed")).toBe("1")
    expect(
      createPwaStore({ win: fakeWindow(), storage }).getSnapshot()
        .installDismissed,
    ).toBe(true)

    const second = createPwaStore({
      win: fakeWindow(),
      storage: memoryStorage(),
    })

    second.markInstalled()
    expect(second.getSnapshot().installDismissed).toBe(true)
  })

  it("works when storage is unavailable or throws", () => {
    const store = createPwaStore({ win: fakeWindow(), storage: null })

    expect(() => store.dismissInstall()).not.toThrow()
    expect(store.getSnapshot().installDismissed).toBe(true)

    const throwing = {
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {
        throw new Error("denied")
      },
    }

    expect(
      createPwaStore({ win: fakeWindow(), storage: throwing }).getSnapshot()
        .installDismissed,
    ).toBe(false)
  })

  it("holds an update until applied, then runs the supplied apply function once", async () => {
    const store = createPwaStore({ win: fakeWindow(), storage })
    const apply = vi.fn(() => Promise.resolve())
    const listener = vi.fn()

    store.subscribe(listener)
    expect(store.getSnapshot().updateReady).toBe(false)

    store.setUpdateReady(apply)
    expect(store.getSnapshot().updateReady).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    await store.applyUpdate()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it("applyUpdate with nothing waiting is a no-op", async () => {
    const store = createPwaStore({ win: fakeWindow(), storage })

    await expect(store.applyUpdate()).resolves.toBeUndefined()
  })

  it("keeps the snapshot object stable between changes", () => {
    const store = createPwaStore({ win: fakeWindow(), storage })

    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })
})
