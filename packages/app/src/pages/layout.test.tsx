import { cleanup, render, screen } from "@testing-library/react"
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { afterEach, describe, expect, it } from "vitest"
import { AppShell } from "./layout.js"

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
