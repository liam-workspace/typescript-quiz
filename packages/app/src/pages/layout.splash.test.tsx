import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * C3: every in-app navigation is a full page load (`window.location.assign`),
 * which re-evaluates every module. A splash flag held in module memory was
 * therefore reset on EVERY screen change of the installed app. Each test
 * here re-imports the app's modules to model such a reload.
 */
async function bootInstalledApp(): Promise<HTMLElement | null> {
  vi.resetModules()

  const router = await import("@tanstack/react-router")
  await import("../i18n.js")
  const { pwaStore } = await import("../lib/pwa/pwa-store.js")
  const { AppLayout } = await import("./layout.js")
  const snapshot = pwaStore.getSnapshot()

  vi.spyOn(pwaStore, "getSnapshot").mockReturnValue({
    ...snapshot,
    standalone: true,
  })

  const rootRoute = router.createRootRoute({ component: AppLayout })
  const instance = router.createRouter({
    routeTree: rootRoute.addChildren([
      router.createRoute({
        getParentRoute: () => rootRoute,
        path: "/",
        component: () => <main>library</main>,
      }),
    ]),
    history: router.createMemoryHistory({ initialEntries: ["/"] }),
  })

  await instance.load()

  const { container } = render(<router.RouterProvider router={instance} />)

  return container.ownerDocument.querySelector(".splash")
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe("cold-start splash (C3)", () => {
  it("shows at the first boot of the session, and not again after a full-page navigation", async () => {
    expect(await bootInstalledApp()).toHaveAttribute("data-visible", "true")

    cleanup()

    expect(await bootInstalledApp()).toHaveAttribute("data-visible", "false")
  })

  it("still renders (once per load) when sessionStorage throws", async () => {
    // Blocked site data: merely touching `window.sessionStorage` throws.
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError")
    })

    expect(await bootInstalledApp()).toHaveAttribute("data-visible", "true")
  })
})
