import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import type {
  AdminAttemptDetail,
  AdminLearnerPage,
  AdminResultSummary,
} from "../lib/api-types.js"
import { Route as LearnersRoute } from "./admin.learners.js"
import { Route as ResultsRoute } from "./admin.results.js"

const quizId = "454b469b-c146-4a66-80b9-b0344de84279"
const learnerId = "ccd8f2e3-8282-481d-bdf9-afadb69b6a0c"
const attemptId = "59bcb51e-aa3b-434d-89d8-73e52e3a1322"
const attempt: AdminAttemptDetail = {
  attemptId,
  testId: quizId,
  testTitle: "Number practice",
  learnerId,
  learnerName: "Sam Nguyen",
  score: 8,
  maxScore: 10,
  completedAt: "2026-11-16T08:00:00.000Z",
  answers: [
    {
      questionId: "question-1",
      response: { selectedChoiceIds: ["selected-choice-1"] },
      score: 1,
      maxScore: 2,
    },
  ],
}
const result: AdminResultSummary = {
  attemptId,
  testId: quizId,
  testTitle: "Number practice",
  learnerId,
  score: 8,
  maxScore: 10,
  completedAt: "2026-11-16T08:00:00.000Z",
}
const firstPage = { items: [result], nextCursor: "next-page" }
const emptyPage = { items: [], nextCursor: null }
const learners: AdminLearnerPage = {
  items: [
    {
      id: learnerId,
      displayName: "Sam Nguyen",
      email: "sam@example.test",
      attemptCount: 3,
      lastAttemptAt: "2026-11-16T08:00:00.000Z",
    },
  ],
  nextCursor: null,
}

function respondTo(overrides: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    "/api/admin/results?limit=20": firstPage,
    ...overrides,
  }
  const fetch = vi.fn((input: string) => {
    const body = routes[input]

    if (body === undefined) {
      throw new Error(`Unexpected request: ${input}`)
    }

    return Promise.resolve(
      body instanceof Response ? body : Response.json(body),
    )
  })
  vi.stubGlobal("fetch", fetch)

  return fetch
}

function visit(initialEntry = "/admin/results") {
  vi.stubGlobal("scrollTo", vi.fn())
  const root = createRootRoute({ component: Outlet })
  const parent = createRoute({ getParentRoute: () => root, path: "/admin" })
  // Supply the file-route metadata normally added by the route generator.
  Object.assign(ResultsRoute.options, {
    getParentRoute: () => parent,
    path: "/results",
  })
  Object.assign(LearnersRoute.options, {
    getParentRoute: () => parent,
    path: "/learners",
  })
  const router = createRouter({
    routeTree: root.addChildren([
      parent.addChildren([ResultsRoute, LearnersRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    defaultHashScrollIntoView: false,
  })
  render(<RouterProvider router={router} />)

  return router
}

describe("admin results and learners", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("shows completed-attempt scores without exposing learner identity or answers", async () => {
    const fetch = respondTo({
      "/api/admin/results?limit=20": { items: [attempt], nextCursor: null },
    })
    visit()

    const table = await screen.findByRole("table", {
      name: "Completed attempts",
    })
    expect(within(table).getByText("Number practice")).toBeInTheDocument()
    expect(within(table).getByText("8 / 10")).toBeInTheDocument()
    expect(screen.queryByText("Sam Nguyen")).not.toBeInTheDocument()
    expect(within(table).queryByText(learnerId)).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Sam Nguyen/i })).toBeNull()
    expect(
      within(table).getByRole("link", {
        name: "View attempt on Number practice",
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/selected-choice-1/)).not.toBeInTheDocument()
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/admin/results?limit=20",
    ])
  })

  it("applies quiz and learner filters from the first page", async () => {
    respondTo({
      "/api/admin/results?limit=20&cursor=next-page": firstPage,
      [`/api/admin/results?limit=20&testId=${quizId}&learnerId=${learnerId}`]: {
        items: [{ ...result, testTitle: "Filtered quiz" }],
        nextCursor: null,
      },
    })
    const user = userEvent.setup()
    const router = visit("/admin/results?cursor=next-page")

    await user.type(
      await screen.findByRole("textbox", { name: "Quiz ID" }),
      quizId,
    )
    await user.type(
      screen.getByRole("textbox", { name: "Learner ID" }),
      learnerId,
    )
    await user.click(screen.getByRole("button", { name: "Apply filters" }))

    expect(await screen.findByText("Filtered quiz")).toBeInTheDocument()
    expect(router.state.location.search).toEqual({ testId: quizId, learnerId })
  })

  it("reports when filters match no results and lets the admin clear them", async () => {
    respondTo({ [`/api/admin/results?limit=20&testId=${quizId}`]: emptyPage })
    const user = userEvent.setup()
    visit(`/admin/results?testId=${quizId}`)

    expect(await screen.findByRole("status")).toHaveTextContent(
      /no results match/i,
    )
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    await user.click(screen.getByRole("link", { name: "Clear filters" }))
    expect(await screen.findByText("Number practice")).toBeInTheDocument()
  })

  it("loads the next cursor with the active quiz filter", async () => {
    respondTo({
      [`/api/admin/results?limit=20&testId=${quizId}`]: firstPage,
      [`/api/admin/results?limit=20&testId=${quizId}&cursor=next-page`]: {
        items: [{ ...result, testTitle: "Advanced number practice" }],
        nextCursor: null,
      },
    })
    const user = userEvent.setup()
    visit(`/admin/results?testId=${quizId}`)

    await user.click(await screen.findByRole("link", { name: "Next page" }))
    expect(
      await screen.findByText("Advanced number practice"),
    ).toBeInTheDocument()
    expect(screen.queryByText("Number practice")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Next page" }),
    ).not.toBeInTheDocument()
  })

  it("opens audited read-only detail on activation and returns to the same results", async () => {
    const detailUrl = `/api/admin/results/attempts/${attemptId}`
    const fetch = respondTo({
      [`/api/admin/results?limit=20&learnerId=${learnerId}`]: firstPage,
      [detailUrl]: attempt,
    })
    const user = userEvent.setup()
    const router = visit(`/admin/results?learnerId=${learnerId}`)
    const link = await screen.findByRole("link", { name: /view attempt/i })
    await user.hover(link)
    expect(fetch.mock.calls.map(([url]) => url)).not.toContain(detailUrl)

    await user.click(link)

    expect(
      await screen.findByRole("heading", { name: "Attempt detail" }),
    ).toBeInTheDocument()
    expect(screen.getByText(/read-only/i)).toHaveTextContent(/audited/i)
    expect(screen.getByText("Sam Nguyen")).toBeInTheDocument()
    expect(screen.getByText("selected-choice-1")).toBeInTheDocument()
    expect(
      screen.queryByRole("table", { name: "Completed attempts" }),
    ).not.toBeInTheDocument()
    expect(router.state.location.search).toEqual({ learnerId, attemptId })

    await user.click(screen.getByRole("link", { name: "Back to results" }))
    await user.click(await screen.findByRole("link", { name: /view attempt/i }))
    expect(await screen.findByText("selected-choice-1")).toBeInTheDocument()
    expect(fetch.mock.calls.filter(([url]) => url === detailUrl)).toHaveLength(
      2,
    )
  })

  it("keeps answers hidden when the audited attempt request fails", async () => {
    respondTo({
      [`/api/admin/results/attempts/${attemptId}`]: Response.json(
        { type: "attempt_not_found", title: "Private detail", status: 404 },
        { status: 404 },
      ),
    })
    visit(`/admin/results?attemptId=${attemptId}`)

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not load/i,
    )
    expect(screen.queryByText("Private detail")).not.toBeInTheDocument()
    expect(screen.queryByText("selected-choice-1")).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Back to results" }),
    ).toBeInTheDocument()
  })

  it("focuses a local learner’s completed result history without requesting answers", async () => {
    const fetch = respondTo({
      "/api/admin/learners?limit=20&search=Sam": learners,
      [`/api/admin/results?limit=5&learnerId=${learnerId}`]: firstPage,
    })
    const user = userEvent.setup()
    visit("/admin/learners?search=Sam")

    expect(await screen.findByText("sam@example.test")).toBeInTheDocument()
    screen.getByRole("link", { name: /view history/i }).focus()
    await user.keyboard("{Enter}")

    const history = await screen.findByRole("region", {
      name: /result history/i,
    })
    expect(
      within(history).getByRole("heading", {
        name: "Result history for Sam Nguyen",
      }),
    ).toHaveFocus()
    expect(within(history).getByText("Number practice")).toBeInTheDocument()
    expect(within(history).getByText("8 / 10")).toBeInTheDocument()
    expect(
      within(history).getByRole("link", { name: "View all results" }),
    ).toHaveAttribute("href", `/admin/results?learnerId=${learnerId}`)
    expect(fetch.mock.calls.map(([url]) => url)).not.toContain(
      `/api/admin/results/attempts/${attemptId}`,
    )
  })
})
