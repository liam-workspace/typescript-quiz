import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { ApiError } from "../lib/api-client.js"
import type { AttemptHistoryPage, Student } from "../lib/api-types.js"
import { renderWithRouter } from "../test/renderWithRouter.js"
import { HistoryRouteError, HistoryScreen, loadHistory } from "./history.js"

const firstPage: AttemptHistoryPage = {
  attempts: [
    {
      id: "attempt-submitted",
      test: { title: "Practice Test 04" },
      submittedAt: "2026-08-25T08:48:34.000Z",
      status: "submitted",
      pointsEarned: 36,
      pointsPossible: 40,
      percentage: 90,
      sections: [
        {
          title: "Listening",
          type: "listening",
          pointsEarned: 18,
          pointsPossible: 20,
        },
        {
          title: "Reading",
          type: "reading",
          pointsEarned: 18,
          pointsPossible: 20,
        },
      ],
    },
    {
      id: "attempt-expired",
      test: { title: "Practice Test 03" },
      submittedAt: "2026-08-21T10:02:55.000Z",
      status: "expired",
      pointsEarned: 33,
      pointsPossible: 40,
      percentage: 82.5,
      sections: [
        {
          title: "Listening",
          type: "listening",
          pointsEarned: 16,
          pointsPossible: 20,
        },
        {
          title: "Reading",
          type: "reading",
          pointsEarned: 17,
          pointsPossible: 20,
        },
      ],
    },
  ],
  nextCursor: "cursor-page-2",
}

const lastPage: AttemptHistoryPage = {
  attempts: [
    {
      id: "attempt-older",
      test: { title: "Practice Test 02" },
      submittedAt: "2026-08-14T09:14:02.000Z",
      status: "submitted",
      pointsEarned: 30,
      pointsPossible: 40,
      percentage: 75,
      sections: [
        {
          title: "Listening",
          type: "listening",
          pointsEarned: 14,
          pointsPossible: 20,
        },
        {
          title: "Reading",
          type: "reading",
          pointsEarned: 16,
          pointsPossible: 20,
        },
      ],
    },
  ],
  nextCursor: null,
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

type HistoryScreenWithStudentProps = React.ComponentProps<
  typeof HistoryScreen
> & {
  readonly student: Student | null
}

const HistoryScreenWithStudent =
  HistoryScreen as React.ComponentType<HistoryScreenWithStudentProps>

function renderHistory(
  initialPage: AttemptHistoryPage,
  student: Student | null = tom,
) {
  return renderWithRouter(
    <HistoryScreenWithStudent initialPage={initialPage} student={student} />,
    "/history",
  )
}

describe("attempt history page", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("loads finished attempts and the current student together", async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      if (input === "/api/attempts?status=finished&limit=20") {
        return Promise.resolve(response(firstPage))
      }

      if (input === "/api/me") {
        return Promise.resolve(response(tom))
      }

      return Promise.reject(new Error(`Unexpected request: ${String(input)}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    const data = await loadHistory()

    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      "/api/attempts?status=finished&limit=20",
      "/api/me",
    ])
    expect(data).toEqual({ initialPage: firstPage, student: tom })
  })

  it("uses the prototype history shell and a labelled horizontal table region", () => {
    const { container } = renderHistory(firstPage)

    expect(screen.getByRole("banner")).toHaveClass("app-bar")
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    expect(screen.getByText("Your attempts")).toHaveClass("app-brand")
    expect(container.querySelector(".student-avatar")).toHaveTextContent("T")
    expect(screen.getByRole("main")).toHaveClass("device-main")
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass(
      "screen-title",
    )
    expect(
      screen.getByText("Every test you have finished, newest first."),
    ).toHaveClass("screen-subtitle")

    const tableRegion = screen.getByRole("region", {
      name: "Attempt history",
    })
    expect(tableRegion).toHaveClass("overflow-x-auto")
    expect(within(tableRegion).getByRole("table")).toHaveClass(
      "history-table",
      "min-w-[720px]",
    )

    expect(screen.getByRole("contentinfo")).toHaveClass("device-footer")
    expect(screen.getByRole("link", { name: "Back to library" })).toHaveClass(
      "device-button",
    )
  })

  it("opens an accessible student menu from the history app bar", async () => {
    const user = userEvent.setup()
    renderHistory(firstPage)

    const trigger = screen.getByRole("button", { name: "Open menu" })
    await user.click(trigger)

    expect(trigger).toHaveAttribute("aria-expanded", "true")
    const menu = screen.getByRole("dialog", { name: "Menu" })
    expect(within(menu).getByText("Tom")).toBeInTheDocument()
    expect(
      within(menu).getByRole("button", { name: "Test library" }),
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole("button", { name: "Attempt history" }),
    ).toBeInTheDocument()

    await user.keyboard("{Escape}")

    expect(
      screen.queryByRole("dialog", { name: "Menu" }),
    ).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("renders one row per finished attempt with its per-section and total scores", () => {
    renderHistory(firstPage)

    const submittedRow = screen.getByRole("row", {
      name: /Practice Test 04/u,
    })
    const expiredRow = screen.getByRole("row", { name: /Practice Test 03/u })

    expect(screen.getAllByRole("row")).toHaveLength(3)
    expect(within(submittedRow).getAllByText("18 / 20")).toHaveLength(2)
    expect(within(submittedRow).getByText("36 / 40")).toBeInTheDocument()
    expect(within(submittedRow).getByText("90%")).toHaveClass("score-badge")
    expect(within(submittedRow).getByText("90%")).toHaveAttribute(
      "data-score-band",
      "high",
    )
    expect(within(expiredRow).getByText("16 / 20")).toBeInTheDocument()
    expect(within(expiredRow).getByText("17 / 20")).toBeInTheDocument()
    expect(within(expiredRow).getByText("33 / 40")).toBeInTheDocument()
    expect(within(expiredRow).getByText("82.5%")).toHaveClass("score-badge")
    expect(within(expiredRow).getByText("82.5%")).toHaveAttribute(
      "data-score-band",
      "mid",
    )
    expect(within(submittedRow).getByRole("time")).toHaveAttribute(
      "datetime",
      "2026-08-25T08:48:34.000Z",
    )
    expect(
      within(submittedRow).getByRole("link", { name: "Review" }),
    ).toHaveAttribute("href", "/attempts/attempt-submitted/review")
    expect(within(submittedRow).getByRole("time")).toHaveTextContent("Aug 25")
    expect(within(submittedRow).getByRole("time")).not.toHaveTextContent("2026")
    expect(
      screen.queryByText("No finished attempts yet."),
    ).not.toBeInTheDocument()
  })

  it("renders 'Time ran out' styling, not the ordinary 'Handed in' text, for a status: expired row", () => {
    renderHistory(firstPage)

    const row = screen.getByRole("row", { name: /Practice Test 03/u })
    expect(within(row).getByText("Time ran out")).toHaveClass("text-amber")
    expect(within(row).getByText("Time ran out")).toHaveAttribute(
      "data-ended",
      "expired",
    )
    expect(within(row).queryByText("Handed in")).not.toBeInTheDocument()
  })

  it("renders ordinary 'Handed in' styling, not 'Time ran out', for a status: submitted row", () => {
    renderHistory(firstPage)

    const row = screen.getByRole("row", { name: /Practice Test 04/u })
    expect(within(row).getByText("Handed in")).toHaveClass("text-ink-2")
    expect(within(row).getByText("Handed in")).toHaveAttribute(
      "data-ended",
      "submitted",
    )
    expect(within(row).queryByText("Time ran out")).not.toBeInTheDocument()
  })

  it("fetches the next page on Load more and appends rather than replaces the rows", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(lastPage))
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()
    renderHistory(firstPage)

    const loadMore = screen.getByRole("button", { name: "Load more" })
    expect(loadMore).toBeEnabled()
    await user.click(loadMore)

    expect(
      await screen.findByRole("row", { name: /Practice Test 02/u }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("row", { name: /Practice Test 04/u }),
    ).toBeInTheDocument()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/attempts?status=finished&limit=20&cursor=cursor-page-2",
    )
    expect(
      screen.getByRole("button", { name: "No older attempts" }),
    ).toBeDisabled()
  })

  it("disables Load more when nextCursor is null", () => {
    renderHistory(lastPage)

    const terminalPagination = screen.getByRole("button", {
      name: "No older attempts",
    })
    expect(terminalPagination).toBeDisabled()
    expect(terminalPagination).toHaveClass("device-button", "w-full")
    expect(terminalPagination).toHaveAttribute("data-variant", "secondary")
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument()
  })

  it("disables Load more while a page is in flight and re-enables it when another cursor arrives", async () => {
    let resolvePage: (response: Response) => void = () => {
      throw new Error("Page resolver was not initialized")
    }
    const pendingPage = new Promise<Response>((resolve) => {
      resolvePage = resolve
    })
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockReturnValue(pendingPage))
    const user = userEvent.setup()
    renderHistory(firstPage)

    const loadMore = screen.getByRole("button", { name: "Load more" })
    await user.click(loadMore)

    expect(loadMore).toBeDisabled()
    expect(loadMore).toHaveAttribute("aria-busy", "true")

    resolvePage(
      response({ attempts: lastPage.attempts, nextCursor: "cursor-page-3" }),
    )

    await vi.waitFor(() => {
      expect(loadMore).toBeEnabled()
    })
    expect(loadMore).toHaveAttribute("aria-busy", "false")
  })

  it("keeps loaded rows and offers another try when the next page fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        response(
          {
            type: "bad_cursor",
            title: "The cursor could not be decoded.",
            status: 400,
          },
          400,
        ),
      ),
    )
    const user = userEvent.setup()
    renderHistory(firstPage)

    await user.click(screen.getByRole("button", { name: "Load more" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Older attempts could not be loaded. Try again.",
    )
    expect(
      screen.getByRole("row", { name: /Practice Test 04/u }),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled()
  })

  it("renders a useful empty state when there are no finished attempts", () => {
    renderHistory({ attempts: [], nextCursor: null })

    expect(screen.getByText("No finished attempts yet.")).toBeInTheDocument()
    expect(
      screen.queryByRole("row", { name: /Practice Test/u }),
    ).not.toBeInTheDocument()
  })

  it("navigates back to the registered library route without reloading the document", async () => {
    const user = userEvent.setup()
    const { router } = renderWithRouter(
      <HistoryScreen initialPage={lastPage} />,
      "/history",
    )

    await user.click(screen.getByRole("link", { name: "Back to library" }))

    expect(router.state.location.pathname).toBe("/")
  })

  it("marks a section as not included when another test establishes that column", () => {
    renderHistory({
      attempts: [
        firstPage.attempts[0],
        {
          ...lastPage.attempts[0],
          sections: [lastPage.attempts[0].sections[0]],
        },
      ],
      nextCursor: null,
    })

    const row = screen.getByRole("row", { name: /Practice Test 02/u })
    expect(within(row).getByText("14 / 20")).toBeInTheDocument()
    expect(within(row).getByText("Not included")).toBeInTheDocument()
  })

  it("renders the signed-out route error for a 401", () => {
    render(
      <HistoryRouteError
        error={
          new ApiError({
            type: "unauthorized",
            title: "Missing, invalid or expired token.",
            status: 401,
          })
        }
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sign in again to view your attempt history.",
    )
  })

  it("renders the generic route error, not the signed-out one, for a non-401", () => {
    render(<HistoryRouteError error={new Error("network down")} />)

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Attempt history could not be loaded. Please try again.",
    )
  })
})
