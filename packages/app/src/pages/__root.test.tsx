import { render, waitFor } from "@testing-library/react"
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import "../i18n.js"
import { tokenStore } from "../lib/tokenStore.js"
import { Route as rootRoute } from "./__root.js"

/**
 * Task 4 Step 1's actual integration point: `requireAuth` is unit-tested
 * in isolation (`test/auth-guard.test.ts`), but THIS proves it is really
 * wired into the root route's `beforeLoad` -- "ONE guard... not per
 * route" only means something if the root route itself enforces it.
 */
describe("the root route's auth guard", () => {
  beforeEach(() => {
    tokenStore.clear()
  })

  afterEach(() => {
    tokenStore.clear()
  })

  function buildRouter(initialEntry: string) {
    const protectedRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/protected",
      component: () => <div>protected content</div>,
    })
    const signInRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/sign-in",
      component: () => <div>sign-in screen</div>,
    })
    const routeTree = rootRoute.addChildren([protectedRoute, signInRoute])

    return createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: [initialEntry] }),
    })
  }

  it("redirects an unauthenticated visit to a protected route to /sign-in", async () => {
    const router = buildRouter("/protected")

    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/sign-in")
    })
  })

  it("lets an authenticated visit through to the protected route", async () => {
    tokenStore.set("access_token", "token-abc")

    const router = buildRouter("/protected")

    const { findByText } = render(<RouterProvider router={router} />)

    expect(await findByText("protected content")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/protected")
  })
})
