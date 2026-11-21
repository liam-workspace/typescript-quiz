import { pwaStore } from "./pwa-store.js"

type RegisterSW = (options: {
  immediate?: boolean
  onNeedRefresh?: () => void
  onRegisterError?: (error: unknown) => void
}) => (reloadPage?: boolean) => Promise<void>

export interface RegisterDeps {
  readonly enabled: boolean
  readonly loadRegister: () => Promise<RegisterSW>
  readonly store: { setUpdateReady(apply: () => Promise<void>): void }
}

const loadVirtualRegister = async (): Promise<RegisterSW> =>
  (await import("virtual:pwa-register")).registerSW

/**
 * Registers the service worker (production builds only) and hands a waiting
 * update to `pwaStore`. The worker never activates itself (`registerType:
 * "prompt"`); `applyUpdate()` → `update(true)` does, from the Refresh button
 * or the Profile row, never during a test (layout defers the banner).
 */
export function registerPwa(deps: Partial<RegisterDeps> = {}): void {
  const {
    enabled = import.meta.env.PROD,
    loadRegister = loadVirtualRegister,
    store = pwaStore,
  } = deps

  if (!enabled) {
    return
  }

  loadRegister()
    .then((registerSW) => {
      const update = registerSW({
        immediate: true,
        onNeedRefresh() {
          store.setUpdateReady(() => update(true))
        },
        onRegisterError() {
          // No worker means no offline shell, not a broken app.
        },
      })
    })
    .catch(() => undefined)
}
