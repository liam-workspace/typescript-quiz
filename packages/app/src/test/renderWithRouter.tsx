import { render } from "@testing-library/react"
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import type { ReactNode } from "react"

export function renderWithRouter(children: ReactNode, initialEntry = "/") {
  const rootRoute = createRootRoute()
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/history" }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/attempts/$attemptId/run",
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/attempts/$attemptId/result",
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/attempts/$attemptId/review",
    }),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })

  return {
    router,
    ...render(
      <RouterContextProvider router={router}>{children}</RouterContextProvider>,
    ),
  }
}
