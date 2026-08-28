import { cleanup, render, screen, within } from "@testing-library/react"
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
import { ApiError } from "../lib/api-client.js"
import type { Student, TestCard, TestCatalogPage } from "../lib/api-types.js"
import { LibraryRouteError, LibraryScreen, loadLibrary } from "./index.js"

const freshTest: TestCard = {
  id: "test-04",
  slug: "primary-practice-04",
  title: "TOEFL Primary — Practice Test 04",
  level: "primary-step-1",
  durationSeconds: 3000,
  sections: [
    { type: "listening", questionCount: 20 },
    { type: "reading", questionCount: 20 },
  ],
  inProgressAttemptId: null,
  attemptCount: 0,
  bestAttempt: null,
}

const activeTest: TestCard = {
  ...freshTest,
  id: "test-03",
  slug: "primary-practice-03",
  title: "TOEFL Primary — Practice Test 03",
  inProgressAttemptId: "attempt-active",
  attemptCount: 1,
  bestAttempt: {
    attemptId: "attempt-older",
    submittedAt: "2026-08-14T09:00:00.000Z",
    pointsEarned: 33,
    pointsPossible: 40,
    percentage: 82.5,
  },
}

const finishedTest: TestCard = {
  ...freshTest,
  id: "test-02",
  slug: "primary-practice-02",
  title: "TOEFL Primary — Practice Test 02",
  attemptCount: 1,
  bestAttempt: {
    attemptId: "attempt-best",
    submittedAt: "2026-08-21T10:15:00.000Z",
    pointsEarned: 36,
    pointsPossible: 40,
    percentage: 90,
  },
}

const initialPage: TestCatalogPage = {
  tests: [freshTest, activeTest, finishedTest],
  nextCursor: null,
  summary: { attemptCount: 3, averagePct: 82.5, bestPct: 90 },
}

const tom: Student = {
  id: "student-1",
  displayName: "Tom",
  email: "tom@example.com",
  level: "primary-step-1",
  isAdmin: false,
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type":
        status >= 400 ? "application/problem+json" : "application/json",
    },
  })
}

async function renderLibrary(
  page: TestCatalogPage = initialPage,
  student: Student | null = tom,
) {
  vi.stubGlobal("scrollTo", vi.fn())
  const rootRoute = createRootRoute({ component: Outlet })
  const libraryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <LibraryScreen initialPage={page} student={student} />,
  })
  const historyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/history",
    component: () => null,
  })
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/attempts/$attemptId/run",
    component: () => null,
  })
  const resultRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/attempts/$attemptId/result",
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      libraryRoute,
      historyRoute,
      runRoute,
      resultRoute,
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })

  await router.load()

  return render(<RouterProvider router={router} />)
}

describe("test library page", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("loads the catalog and profile together and renders the named greeting", async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      if (input === "/api/tests") {
        return Promise.resolve(response(initialPage))
      }

      if (input === "/api/me") {
        return Promise.resolve(response(tom))
      }

      return Promise.reject(new Error("Unexpected request"))
    })
    vi.stubGlobal("fetch", fetchMock)

    const data = await loadLibrary()
    await renderLibrary(data.initialPage, data.student)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Welcome back, Tom",
    )
    expect(screen.getByText("You have 3 tests waiting.")).toBeInTheDocument()
  })

  it("keeps the catalog usable with an anonymous greeting when GET /me fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((input) =>
        Promise.resolve(
          input === "/api/tests"
            ? response(initialPage)
            : response(
                {
                  type: "profile_unavailable",
                  title: "Unavailable",
                  status: 500,
                },
                500,
              ),
        ),
      ),
    )

    const data = await loadLibrary()
    await renderLibrary(data.initialPage, data.student)

    expect(data.student).toBeNull()
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Welcome back",
    )
    expect(screen.queryByText("Welcome back, Tom")).not.toBeInTheDocument()
    expect(screen.getByText(freshTest.title)).toBeInTheDocument()
  })

  it("renders card metadata and both directions of every action rule", async () => {
    await renderLibrary()

    const freshCard = screen.getByRole("article", { name: freshTest.title })
    expect(within(freshCard).getByText("Step 1")).toBeInTheDocument()
    expect(within(freshCard).getByText("Listening 20")).toBeInTheDocument()
    expect(within(freshCard).getByText("Reading 20")).toBeInTheDocument()
    expect(within(freshCard).getByText("50 minutes")).toBeInTheDocument()
    expect(
      within(freshCard).getByRole("link", { name: "Start test" }),
    ).toHaveAttribute("href", "/tests/primary-practice-04")
    expect(
      within(freshCard).queryByRole("link", { name: "See result" }),
    ).not.toBeInTheDocument()

    const activeCard = screen.getByRole("article", { name: activeTest.title })
    expect(
      within(activeCard).getByRole("link", { name: "Continue" }),
    ).toHaveAttribute("href", "/attempts/attempt-active/run")
    expect(
      within(activeCard).queryByRole("link", { name: "Start test" }),
    ).not.toBeInTheDocument()
    expect(
      within(activeCard).queryByRole("link", { name: "Try again" }),
    ).not.toBeInTheDocument()
    expect(
      within(activeCard).queryByRole("link", { name: "See result" }),
    ).not.toBeInTheDocument()

    const finishedCard = screen.getByRole("article", {
      name: finishedTest.title,
    })
    expect(
      within(finishedCard).getByRole("link", { name: "Try again" }),
    ).toHaveAttribute("href", "/tests/primary-practice-02")
    expect(
      within(finishedCard).getByRole("link", { name: "See result" }),
    ).toHaveAttribute("href", "/attempts/attempt-best/result")
    expect(
      within(finishedCard).queryByRole("link", { name: "Continue" }),
    ).not.toBeInTheDocument()
  })

  it("renders a real empty state and no pagination control", async () => {
    await renderLibrary({ ...initialPage, tests: [] })

    expect(screen.getByRole("status")).toHaveTextContent(
      "No practice tests are available yet.",
    )
    expect(
      screen.queryByRole("button", { name: "Show more tests" }),
    ).not.toBeInTheDocument()
  })

  it("appends short pages and stops only when nextCursor is null", async () => {
    const user = userEvent.setup()
    const secondTest = { ...freshTest, id: "test-05", title: "Test 05" }
    const thirdTest = { ...freshTest, id: "test-06", title: "Test 06" }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          tests: [secondTest],
          nextCursor: "third-page",
          summary: initialPage.summary,
        } satisfies TestCatalogPage),
      )
      .mockResolvedValueOnce(
        response({
          tests: [thirdTest],
          nextCursor: null,
          summary: initialPage.summary,
        } satisfies TestCatalogPage),
      )
    vi.stubGlobal("fetch", fetchMock)
    await renderLibrary({
      ...initialPage,
      tests: [freshTest],
      nextCursor: "second-page",
    })

    await user.click(screen.getByRole("button", { name: "Show more tests" }))

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/tests?cursor=second-page")
    expect(screen.getByText(secondTest.title)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Show more tests" }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Show more tests" }))

    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/tests?cursor=third-page")
    expect(screen.getByText(freshTest.title)).toBeInTheDocument()
    expect(screen.getByText(secondTest.title)).toBeInTheDocument()
    expect(screen.getByText(thirdTest.title)).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Show more tests" }),
    ).not.toBeInTheDocument()
  })

  it("keeps pagination retryable and shows an alert when a later page fails", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    )
    await renderLibrary({
      ...initialPage,
      tests: [freshTest],
      nextCursor: "second-page",
    })

    await user.click(screen.getByRole("button", { name: "Show more tests" }))

    expect(screen.getByRole("alert")).toHaveTextContent(
      "More tests could not be loaded. Try again.",
    )
    expect(
      screen.getByRole("button", { name: "Show more tests" }),
    ).toBeEnabled()
  })

  it("renders the sign-in error only for a 401", () => {
    render(
      <LibraryRouteError
        error={
          new ApiError({
            type: "unauthorized",
            title: "Unauthorized",
            status: 401,
          })
        }
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sign in again to view the test library.",
    )
  })

  it("renders the generic catalog error for a non-401", () => {
    render(<LibraryRouteError error={new Error("network down")} />)

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The test library could not be loaded. Please try again.",
    )
  })
})
