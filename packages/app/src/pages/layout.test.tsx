import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { networkStore } from "../lib/network.js"
import { pendingCountStore } from "../lib/pending-count.js"
import { pwaStore } from "../lib/pwa/pwa-store.js"
import { toastStore } from "../lib/toast.js"
import { AppLayout, AppShell } from "./layout.js"

describe("AppShell", () => {
  afterEach(cleanup)

  it("does not add generic Card padding around full-height device pages", () => {
    render(
      <AppShell>
        <div data-testid="device-page" />
      </AppShell>,
    )

    expect(screen.getByTestId("device-page").parentElement).toHaveClass(
      "app-shell",
    )
    expect(screen.getByTestId("device-page").parentElement).not.toHaveAttribute(
      "data-slot",
      "card",
    )
  })

  it("renders a routed screen with exactly one main landmark", async () => {
    const rootRoute = createRootRoute({
      component: () => (
        <AppShell>
          <Outlet />
        </AppShell>
      ),
    })
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => <main>Route content</main>,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    })

    await router.load()
    render(<RouterProvider router={router} />)

    expect(screen.getAllByRole("main")).toHaveLength(1)
    expect(screen.getByRole("main")).toHaveTextContent("Route content")
  })
})

async function renderAt(path: string) {
  const rootRoute = createRootRoute({ component: AppLayout })
  const page = (label: string) => () => <main>{label}</main>
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/",
        component: page("library page"),
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/history",
        component: page("history page"),
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/profile",
        component: page("profile page"),
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/attempts/$attemptId/run",
        component: page("run page"),
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/attempts/$attemptId/result",
        component: page("result page"),
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/attempts/$attemptId/sections/$sectionId/rules",
        component: page("rules page"),
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/admin",
        component: page("admin page"),
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  await router.load()
  render(<RouterProvider router={router} />)

  return router
}

describe("AppLayout chrome", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    networkStore.setOnlineForTests(true)
    pendingCountStore.set(0)
  })

  it.each(["/", "/history", "/profile"])(
    "shows the tab bar on %s",
    async (path) => {
      await renderAt(path)

      expect(
        screen.getByRole("navigation", { name: "Main" }),
      ).toBeInTheDocument()
    },
  )

  it.each(["/attempts/a1/run", "/admin"])(
    "shows no tab bar on %s",
    async (path) => {
      await renderAt(path)

      expect(
        screen.queryByRole("navigation", { name: "Main" }),
      ).not.toBeInTheDocument()
    },
  )

  it("marks the current tab and switches route when another tab is tapped", async () => {
    const user = userEvent.setup()
    const router = await renderAt("/")

    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    await user.click(screen.getByRole("link", { name: "Profile" }))

    expect(router.state.location.pathname).toBe("/profile")
    expect(await screen.findByText("profile page")).toBeInTheDocument()
  })

  it("shows the browsing offline banner with the queue count outside a test", async () => {
    pendingCountStore.set(2)
    networkStore.setOnlineForTests(false)
    await renderAt("/history")

    expect(
      screen.getByText(/Showing what is saved on this phone/u),
    ).toBeInTheDocument()
    expect(screen.getByText("Waiting to be sent: 2")).toBeInTheDocument()
  })

  it("leaves the offline banner to the run screen on the run route", async () => {
    networkStore.setOnlineForTests(false)
    await renderAt("/attempts/a1/run")

    expect(
      screen.queryByText(/Showing what is saved on this phone/u),
    ).not.toBeInTheDocument()
  })

  it.each(["/attempts/a1/result", "/attempts/a1/sections/s1/rules"])(
    "shows the browsing offline banner on %s",
    async (path) => {
      networkStore.setOnlineForTests(false)
      await renderAt(path)

      expect(screen.getByTestId("offline-banner")).toHaveAttribute(
        "data-variant",
        "browsing",
      )
    },
  )

  it("announces going offline and coming back through one polite live region", async () => {
    await renderAt("/")

    act(() => networkStore.setOnlineForTests(false))
    expect(
      await screen.findByText(
        "You are offline. Answers will be saved on this phone.",
      ),
    ).toBeInTheDocument()

    act(() => networkStore.setOnlineForTests(true))
    expect(await screen.findByText("Back online.")).toBeInTheDocument()
  })

  it("shows a ready update with Refresh normally, and the deferred wording with no button during a test", async () => {
    const ready = { ...pwaStore.getSnapshot(), updateReady: true }

    vi.spyOn(pwaStore, "getSnapshot").mockReturnValue(ready)
    await renderAt("/")

    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument()
    cleanup()

    await renderAt("/attempts/a1/run")
    expect(
      screen.getByText(/It will install after you finish this test/u),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Refresh" }),
    ).not.toBeInTheDocument()
  })

  it("renders toasts from the toast store", async () => {
    await renderAt("/")

    act(() => toastStore.show("Installed. Open it from your home screen."))
    expect(
      await screen.findByText("Installed. Open it from your home screen."),
    ).toBeInTheDocument()
  })

  it("constrains student screens to the app column but leaves admin full width", async () => {
    await renderAt("/")
    expect(document.querySelector(".app-shell")).toHaveClass(
      "app-shell--column",
      "app-shell--tabs",
    )
    cleanup()

    await renderAt("/admin")
    expect(document.querySelector(".app-shell")).not.toHaveClass(
      "app-shell--column",
    )
  })
})
