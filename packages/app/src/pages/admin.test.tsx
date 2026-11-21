import { cleanup, render, screen, within } from "@testing-library/react"
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { requireAdmin } from "../lib/admin-auth.js"
import { ApiError } from "../lib/api-client.js"
import type { Student } from "../lib/api-types.js"
import { getCurrentStudent } from "../lib/session-api.js"
import { AdminLayout, Route } from "./admin.js"

vi.mock("../lib/session-api.js", () => ({ getCurrentStudent: vi.fn() }))

const admin: Student = {
  id: "student-admin",
  displayName: "Admin",
  email: "admin@example.com",
  level: null,
  isAdmin: true,
}

describe("admin route", () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it("redirects an unauthenticated visitor to sign-in", async () => {
    vi.mocked(getCurrentStudent).mockRejectedValue(
      new ApiError({
        type: "unauthorized",
        title: "Unauthorized",
        status: 401,
      }),
    )

    await expect(requireAdmin()).rejects.toMatchObject({
      options: { href: "/sign-in", replace: true },
    })
  })

  it("redirects an authenticated non-admin to the library", async () => {
    vi.mocked(getCurrentStudent).mockResolvedValue({ ...admin, isAdmin: false })

    await expect(requireAdmin()).rejects.toMatchObject({
      options: { to: "/", replace: true },
    })
  })

  it("returns the authenticated admin profile", async () => {
    vi.mocked(getCurrentStudent).mockResolvedValue(admin)

    await expect(requireAdmin()).resolves.toEqual(admin)
  })

  it("preserves profile loading errors other than an unauthenticated session", async () => {
    const error = new Error("Network unavailable")
    vi.mocked(getCurrentStudent).mockRejectedValue(error)

    await expect(requireAdmin()).rejects.toBe(error)
  })

  it("guards the layout and renders accessible navigation with child content", async () => {
    expect(Route.options.beforeLoad).toBe(requireAdmin)
    vi.mocked(getCurrentStudent).mockResolvedValue(admin)
    const rootRoute = createRootRoute()
    const adminRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/admin",
      beforeLoad: requireAdmin,
      component: AdminLayout,
    })
    const overviewRoute = createRoute({
      getParentRoute: () => adminRoute,
      path: "/",
      component: () => <h2>Admin overview content</h2>,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([
        adminRoute.addChildren([overviewRoute]),
      ]),
      history: createMemoryHistory({ initialEntries: ["/admin"] }),
    })

    await router.load()
    render(<RouterProvider router={router} />)

    expect(getCurrentStudent).toHaveBeenCalled()
    expect(
      screen.getByRole("heading", { name: "Administration", level: 1 }),
    ).toBeInTheDocument()
    const navigation = screen.getByRole("navigation", {
      name: "Administration",
    })
    for (const [name, href] of [
      ["Overview", "/admin"],
      ["Candidates", "/admin/candidates"],
      ["Quizzes", "/admin/quizzes"],
      ["Questions", "/admin/questions"],
      ["Results", "/admin/results"],
      ["Learners", "/admin/learners"],
    ]) {
      expect(within(navigation).getByRole("link", { name })).toHaveAttribute(
        "href",
        href,
      )
    }
    expect(
      within(navigation).getByRole("link", { name: "Overview" }),
    ).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("main")).toHaveTextContent("Admin overview content")
  })
})
