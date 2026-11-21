import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import type { AdminOverview, AdminTestPage } from "../lib/api-types.js"
import { renderWithRouter } from "../test/renderWithRouter.js"
import {
  AdminOverviewError,
  AdminOverviewPending,
  AdminOverviewScreen,
  loadAdminOverview,
  Route as OverviewRoute,
} from "./admin.index.js"
import {
  AdminQuizzesError,
  AdminQuizzesPending,
  AdminQuizzesScreen,
  loadAdminQuizzes,
  Route as QuizzesRoute,
} from "./admin.quizzes.js"

const overview: AdminOverview = {
  tests: { total: 12, drafts: 3, published: 8 },
  attempts: { total: 41, inProgress: 6, completed: 35 },
  learners: { total: 19 },
}

const firstPage: AdminTestPage = {
  items: [
    {
      id: "quiz-draft",
      title: "New practice quiz",
      status: "draft",
      currentVersionId: null,
      updatedAt: "2026-11-16T08:00:00.000Z",
    },
    {
      id: "quiz-published",
      title: "Reading practice",
      status: "published",
      currentVersionId: "version-published",
      updatedAt: "2026-11-15T08:00:00.000Z",
    },
  ],
  nextCursor: "next-page",
}

const lastPage: AdminTestPage = {
  items: [
    {
      id: "quiz-archived",
      title: "Earlier practice",
      status: "archived",
      currentVersionId: "version-archived",
      updatedAt: "2026-11-14T08:00:00.000Z",
    },
  ],
  nextCursor: null,
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("admin overview and quiz catalogue", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("loads overview counts and the first catalogue page from the admin APIs", async () => {
    vi.stubGlobal("fetch", (input: unknown) => {
      if (input === "/api/admin/overview") {
        return Promise.resolve(response(overview))
      }

      if (input === "/api/admin/tests?limit=20") {
        return Promise.resolve(response(firstPage))
      }

      throw new Error(`Unexpected request: ${String(input)}`)
    })

    await expect(loadAdminOverview()).resolves.toEqual(overview)
    await expect(loadAdminQuizzes()).resolves.toEqual(firstPage)
  })

  it("registers accessible loading states while route data is pending", () => {
    expect(OverviewRoute.options.pendingComponent).toBe(AdminOverviewPending)
    expect(QuizzesRoute.options.pendingComponent).toBe(AdminQuizzesPending)
    const { unmount } = render(<AdminOverviewPending />)
    expect(screen.getByRole("status")).toHaveTextContent(/loading overview/i)
    unmount()
    render(<AdminQuizzesPending />)
    expect(screen.getByRole("status")).toHaveTextContent(/loading quizzes/i)
  })

  it("renders overview totals with their category labels and a catalogue link", () => {
    renderWithRouter(<AdminOverviewScreen overview={overview} />)

    for (const [label, count] of [
      ["Total quizzes", "12"],
      ["Draft quizzes", "3"],
      ["Published quizzes", "8"],
      ["Total attempts", "41"],
      ["In progress", "6"],
      ["Completed", "35"],
      ["Learners", "19"],
    ]) {
      expect(screen.getByText(label).nextElementSibling).toHaveTextContent(
        count,
      )
    }
    expect(
      screen.getByRole("link", { name: "Browse quizzes" }),
    ).toHaveAttribute("href", "/admin/quizzes")
  })

  it("renders zero overview counts without treating them as loading", () => {
    renderWithRouter(
      <AdminOverviewScreen
        overview={{
          tests: { total: 0, drafts: 0, published: 0 },
          attempts: { total: 0, inProgress: 0, completed: 0 },
          learners: { total: 0 },
        }}
      />,
    )
    expect(screen.getAllByText("0")).toHaveLength(7)
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("registers friendly route errors without exposing internal exception messages", () => {
    expect(OverviewRoute.options.errorComponent).toBe(AdminOverviewError)
    expect(QuizzesRoute.options.errorComponent).toBe(AdminQuizzesError)
    const { unmount } = render(<AdminOverviewError />)
    expect(screen.getByRole("alert")).toHaveTextContent(
      /could not load.*overview/i,
    )
    unmount()
    render(<AdminQuizzesError />)
    expect(screen.getByRole("alert")).toHaveTextContent(
      /could not load.*quizzes/i,
    )
  })

  it("lets failed admin API loads reach the route error boundary", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        response(
          {
            type: "unavailable",
            title: "Unavailable",
            status: 503,
          },
          503,
        ),
      ),
    )
    await expect(loadAdminOverview()).rejects.toThrow()
    await expect(loadAdminQuizzes()).rejects.toThrow()
  })

  it("shows a clear empty catalogue and no pagination action", () => {
    renderWithRouter(
      <AdminQuizzesScreen initialPage={{ items: [], nextCursor: null }} />,
    )
    expect(screen.getByRole("status")).toHaveTextContent(/no quizzes/i)
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Load more quizzes" }),
    ).not.toBeInTheDocument()
  })

  it("labels each lifecycle and links quiz titles to detail without answer keys", () => {
    renderWithRouter(
      <AdminQuizzesScreen
        initialPage={{
          ...firstPage,
          items: firstPage.items.map((item) => ({
            ...item,
            answerKey: "SECRET-ANSWER",
          })),
        }}
      />,
    )
    const region = screen.getByRole("region", { name: "Quiz catalogue" })
    expect(region).toHaveAttribute("tabindex", "0")
    expect(within(region).getByRole("table")).toBeInTheDocument()
    const draft = screen.getByRole("row", { name: /New practice quiz/ })
    expect(within(draft).getByText("Draft")).toBeInTheDocument()
    const published = screen.getByRole("row", { name: /Reading practice/ })
    expect(within(published).getByText("Published")).toBeInTheDocument()
    expect(
      within(draft).getByRole("link", { name: "New practice quiz" }),
    ).toHaveAttribute("href", "/admin/quizzes/quiz-draft")
    expect(within(published).getByRole("time")).toHaveAttribute(
      "datetime",
      "2026-11-15T08:00:00.000Z",
    )
    expect(screen.queryByText("SECRET-ANSWER")).not.toBeInTheDocument()
    expect(screen.queryByText("version-published")).not.toBeInTheDocument()
  })

  it("appends a cursor page and removes the pagination action on the final page", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", (input: unknown) => {
      if (input !== "/api/admin/tests?limit=20&cursor=next-page") {
        throw new Error(`Unexpected request: ${String(input)}`)
      }

      return Promise.resolve(response(lastPage))
    })
    renderWithRouter(<AdminQuizzesScreen initialPage={firstPage} />)
    await user.click(screen.getByRole("button", { name: "Load more quizzes" }))
    expect(
      await screen.findByRole("link", { name: "Earlier practice" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Archived")).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "New practice quiz" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Load more quizzes" }),
    ).not.toBeInTheDocument()
  })

  it("disables pagination while loading and preserves rows on failure for retry", async () => {
    const user = userEvent.setup()
    let rejectRequest: (error: Error) => void = () => undefined
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((_, reject) => {
          rejectRequest = reject
        }),
    )
    renderWithRouter(<AdminQuizzesScreen initialPage={firstPage} />)
    await user.click(screen.getByRole("button", { name: "Load more quizzes" }))
    expect(screen.getByRole("button", { name: /loading/i })).toBeDisabled()
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i)
    rejectRequest(new Error("Private connection detail"))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not load more quizzes/i,
    )
    expect(
      screen.queryByText("Private connection detail"),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "New practice quiz" }),
    ).toBeInTheDocument()
    vi.stubGlobal("fetch", () => Promise.resolve(response(lastPage)))
    await user.click(screen.getByRole("button", { name: "Load more quizzes" }))
    expect(
      await screen.findByRole("link", { name: "Earlier practice" }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
