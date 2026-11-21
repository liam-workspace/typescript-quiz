import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
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
import { signOut } from "../lib/auth.js"
import { startInstall } from "../lib/pwa/install-flow.js"
import { startTestAndRulesPath } from "../lib/start-test.js"
import { toastStore } from "../lib/toast.js"
import {
  LibraryRouteError,
  LibraryScreen,
  loadLibrary,
  type LibraryScreenProps,
} from "./index.js"

const { dismissInstall } = vi.hoisted(() => ({ dismissInstall: vi.fn() }))

vi.mock("../lib/start-test.js", () => ({ startTestAndRulesPath: vi.fn() }))
vi.mock("../lib/pwa/install-flow.js", () => ({ startInstall: vi.fn() }))
vi.mock("../lib/pwa/pwa-store.js", () => {
  const snapshot = {
    standalone: false,
    canPromptInstall: true,
    platform: "android",
    installDismissed: false,
    updateReady: false,
  }

  return {
    pwaStore: {
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
      markInstalled: vi.fn(),
      dismissInstall,
    },
  }
})

vi.mock("../lib/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/auth.js")>()),
  signOut: vi.fn(),
}))

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

async function renderLibraryWith(
  props: Omit<LibraryScreenProps, "student"> & {
    readonly student?: Student | null
  },
) {
  vi.stubGlobal("scrollTo", vi.fn())
  const rootRoute = createRootRoute({ component: Outlet })
  const libraryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <LibraryScreen {...props} student={props.student ?? null} />
    ),
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

function renderLibrary(
  page: TestCatalogPage = initialPage,
  student: Student | null = tom,
) {
  return renderLibraryWith({ initialPage: page, student })
}

describe("test library page", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.mocked(startInstall).mockReset()
    vi.mocked(startTestAndRulesPath).mockReset()
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
    expect(screen.getByText("You have one test waiting.")).toBeInTheDocument()
  })

  it("uses the mobile app bar and body for the library", async () => {
    await renderLibrary()

    expect(screen.getByRole("banner")).toHaveClass("m-appbar")
    expect(screen.getByRole("main")).toHaveClass("m-body")
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
    expect(freshCard).toHaveTextContent(
      "Step 1 · Listening 20 · Reading 20 · 50 minutes",
    )
    expect(
      within(freshCard).getByRole("button", { name: "Start test" }),
    ).toBeInTheDocument()
    expect(
      within(freshCard).queryByRole("link", { name: "See result" }),
    ).not.toBeInTheDocument()

    const activeCard = screen.getByRole("article", { name: activeTest.title })
    expect(
      within(activeCard).getByRole("link", { name: "Continue" }),
    ).toHaveAttribute("href", "/attempts/attempt-active/run")
    expect(
      within(activeCard).queryByRole("button", { name: "Start test" }),
    ).not.toBeInTheDocument()
    expect(
      within(activeCard).queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument()
    expect(
      within(activeCard).queryByRole("link", { name: "See result" }),
    ).not.toBeInTheDocument()

    const finishedCard = screen.getByRole("article", {
      name: finishedTest.title,
    })
    expect(
      within(finishedCard).getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument()
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

  it("says you are all caught up when every test has an attempt", async () => {
    await renderLibrary({
      ...initialPage,
      tests: [{ ...finishedTest, attemptCount: 2 }],
    })

    expect(screen.getByText("You're all caught up.")).toBeInTheDocument()
  })

  it("filters the list with the All / To do / Done segmented control", async () => {
    const user = userEvent.setup()

    await renderLibrary()

    await user.click(screen.getByRole("button", { name: "Done" }))
    expect(screen.queryByRole("article", { name: freshTest.title })).toBeNull()
    expect(
      screen.getByRole("article", { name: finishedTest.title }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "To do" }))
    expect(
      screen.getByRole("article", { name: freshTest.title }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("article", { name: finishedTest.title }),
    ).toBeNull()
  })

  it("shows 'Nothing here yet.' when a filter matches no test", async () => {
    const user = userEvent.setup()

    await renderLibrary({ ...initialPage, tests: [freshTest] })
    await user.click(screen.getByRole("button", { name: "Done" }))

    expect(screen.getByRole("status")).toHaveTextContent("Nothing here yet.")
  })

  it("disables Start on other tests while one is in progress and says why", async () => {
    await renderLibrary()

    const start = within(
      screen.getByRole("article", { name: freshTest.title }),
    ).getByRole("button", { name: "Start test" })

    expect(start).toBeDisabled()
    expect(start).toHaveAccessibleDescription(
      `Finish ${activeTest.title} first.`,
    )
  })

  it("starts a test without visiting the brief, then navigates to the rules path", async () => {
    const user = userEvent.setup()
    const navigate = vi.fn()

    vi.mocked(startTestAndRulesPath).mockResolvedValue(
      "/attempts/a1/sections/s1/rules",
    )
    await renderLibraryWith({
      initialPage: { ...initialPage, tests: [freshTest] },
      student: tom,
      navigate,
    })
    await user.click(screen.getByRole("button", { name: "Start test" }))

    expect(startTestAndRulesPath).toHaveBeenCalledWith(freshTest.slug)
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/attempts/a1/sections/s1/rules")
    })
  })

  it("keeps the card usable and shows an alert when starting fails", async () => {
    const user = userEvent.setup()

    vi.mocked(startTestAndRulesPath).mockRejectedValue(new Error("boom"))
    await renderLibraryWith({
      initialPage: { ...initialPage, tests: [freshTest] },
      student: tom,
      navigate: vi.fn(),
    })
    await user.click(screen.getByRole("button", { name: "Start test" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The test could not be started. Please try again.",
    )
    expect(screen.getByRole("button", { name: "Start test" })).toBeEnabled()
  })

  it("uses the injected start gate and card extras", async () => {
    await renderLibraryWith({
      initialPage: { ...initialPage, tests: [freshTest] },
      student: tom,
      startDisabledReason: () => "Go online to start.",
      renderCardExtras: () => <p>extras slot</p>,
    })

    expect(screen.getByRole("button", { name: "Start test" })).toBeDisabled()
    expect(screen.getByText("Go online to start.")).toBeInTheDocument()
    expect(screen.getByText("extras slot")).toBeInTheDocument()
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

  it("offers Try again and Sign out on the generic error", () => {
    render(<LibraryRouteError error={new Error("network down")} />)

    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/",
    )
    expect(screen.getByRole("link", { name: "Sign out" })).toHaveAttribute(
      "href",
      "/sign-in",
    )
  })

  it.each([
    ["404 student_not_provisioned", "student_not_provisioned", 404],
    ["403 role_not_granted", "role_not_granted", 403],
  ])(
    "explains a %s as missing access, with a way to sign out",
    (_name, type, status) => {
      render(
        <LibraryRouteError
          error={new ApiError({ type, title: "No access", status })}
        />,
      )

      expect(screen.getByRole("alert")).toHaveTextContent(
        "This account does not have access to Quiz yet.",
      )
      expect(
        screen.getByText(/Ask an administrator to give this account access/u),
      ).toBeInTheDocument()
      // Retrying cannot fix a missing role, so it is not offered.
      expect(screen.queryByRole("link", { name: "Try again" })).toBeNull()
      expect(screen.getByRole("link", { name: "Sign out" })).toBeInTheDocument()
    },
  )

  it("renders the no-access state as a hero with a lock tile and Sign out", () => {
    const { container } = render(
      <LibraryRouteError
        error={
          new ApiError({
            type: "student_not_provisioned",
            title: "No access",
            status: 404,
          })
        }
      />,
    )

    expect(container.querySelector(".m-hero")).not.toBeNull()
    expect(
      screen.getByText("This account does not have access to Quiz yet."),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sign out" })).toHaveAttribute(
      "href",
      "/sign-in",
    )
    expect(screen.queryByRole("link", { name: "Try again" })).toBeNull()
  })

  it("clears the stored session when Sign out is chosen", async () => {
    const user = userEvent.setup()

    render(<LibraryRouteError error={new Error("network down")} />)
    // Navigation itself is the link's job; jsdom does not follow it.
    const link = screen.getByRole("link", { name: "Sign out" })

    link.addEventListener("click", (event) => event.preventDefault())
    await user.click(link)

    expect(signOut).toHaveBeenCalledTimes(1)
  })
})

describe("library install card", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.mocked(startInstall).mockReset()
  })

  it("does nothing more when the native prompt is accepted, apart from a toast", async () => {
    const user = userEvent.setup()
    const show = vi.spyOn(toastStore, "show")

    vi.mocked(startInstall).mockResolvedValue("accepted")
    await renderLibrary()
    await user.click(screen.getByRole("button", { name: "Install" }))

    expect(startInstall).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(show).toHaveBeenCalledWith(
      "Installed. Open it from your home screen.",
      "check",
    )
    show.mockRestore()
  })

  it("shows neither sheet nor toast when the native prompt is dismissed", async () => {
    const user = userEvent.setup()
    const show = vi.spyOn(toastStore, "show")

    vi.mocked(startInstall).mockResolvedValue("dismissed")
    await renderLibrary()
    await user.click(screen.getByRole("button", { name: "Install" }))

    expect(startInstall).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(show).not.toHaveBeenCalled()
    show.mockRestore()
  })

  it("opens the iOS Share-menu sheet for show-ios", async () => {
    const user = userEvent.setup()

    vi.mocked(startInstall).mockResolvedValue("show-ios")
    await renderLibrary()
    await user.click(screen.getByRole("button", { name: "Install" }))

    expect(
      await screen.findByRole("dialog", { name: "Add to Home Screen" }),
    ).toBeInTheDocument()
  })

  it("opens the manual-steps sheet for show-manual and returns focus to Install on close", async () => {
    const user = userEvent.setup()

    vi.mocked(startInstall).mockResolvedValue("show-manual")
    await renderLibrary()

    const install = screen.getByRole("button", { name: "Install" })

    await user.click(install)
    expect(
      await screen.findByRole("dialog", { name: "Install this app" }),
    ).toBeInTheDocument()

    await user.keyboard("{Escape}")

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull()
    })
    expect(install).toHaveFocus()
  })

  it("dismisses the card through pwaStore", async () => {
    const user = userEvent.setup()

    await renderLibrary()
    await user.click(screen.getByRole("button", { name: "Not now" }))

    expect(dismissInstall).toHaveBeenCalled()
  })
})
