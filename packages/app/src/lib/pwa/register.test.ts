import { describe, expect, it, vi } from "vitest"
import { registerPwa } from "./register.js"

interface Options {
  immediate?: boolean
  onNeedRefresh?: () => void
  onRegisterError?: (e: unknown) => void
}

function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
}

function setup(enabled = true) {
  const update = vi.fn(() => Promise.resolve())
  let captured: Options = {}
  const registerSW = vi.fn((options: Options) => {
    captured = options

    return update
  })
  const store = { setUpdateReady: vi.fn() }

  registerPwa({
    enabled,
    loadRegister: () => Promise.resolve(registerSW),
    store,
  })

  return { registerSW, update, store, options: () => captured }
}

describe("registerPwa", () => {
  it("registers immediately and publishes an update that applies with a reload", async () => {
    const { registerSW, update, store, options } = setup()

    await vi.waitFor(() => expect(registerSW).toHaveBeenCalledTimes(1))
    expect(options().immediate).toBe(true)

    options().onNeedRefresh?.()
    expect(store.setUpdateReady).toHaveBeenCalledTimes(1)

    const apply = store.setUpdateReady.mock.calls[0]?.[0] as () => Promise<void>

    await apply()
    expect(update).toHaveBeenCalledWith(true)
  })

  it("does nothing outside a production build (dev has no worker)", async () => {
    const { registerSW } = setup(false)

    await settle()
    expect(registerSW).not.toHaveBeenCalled()
  })

  it("never throws when the registration module fails to load", async () => {
    expect(() =>
      registerPwa({
        enabled: true,
        loadRegister: () => Promise.reject(new Error("no worker")),
        store: { setUpdateReady: vi.fn() },
      }),
    ).not.toThrow()
    await settle()
  })
})
