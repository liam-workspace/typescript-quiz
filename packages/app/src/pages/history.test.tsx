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

      const target = input instanceof Request ? input.url : input.toString()

      return Promise.reject(new Error(`Unexpected request: ${target}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    const data = await loadHistory()

    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      "/api/attempts?status=finished&limit=20",
      "/api/me",
    ])
    expect(data).toEqual({ initialPage: firstPage, student: tom })
  })

  it("uses the mobile history layout with a focusable page title", () => {
    renderHistory(firstPage)

    expect(screen.getByRole("banner")).toHaveClass("m-appbar")
    expect(screen.getByText("Your attempts")).toHaveClass("m-brand")
    expect(screen.getByRole("main")).toHaveClass("m-body")
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute(
      "tabindex",
      "-1",
    )
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute(
      "data-page-title",
    )
    expect(
      screen.getByText("Every test you have finished, newest first."),
    ).toHaveClass("m-sub")
  })

  it("renders each attempt as a card: title, date, status chip with an icon, score and actions", () => {
    renderHistory(firstPage)

    const cards = screen.getAllByRole("listitem")

    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText("Practice Test 04")).toBeInTheDocument()
    expect(
      within(cards[0]).getByText("Handed in").closest(".m-chip"),
    ).toHaveAttribute("data-tone", "good")
    expect(
      within(cards[1]).getByText("Time ran out").closest(".m-chip"),
    ).toHaveAttribute("data-tone", "warn")
    expect(
      within(cards[0])
        .getByText("Handed in")
        .closest(".m-chip")
        ?.querySelector("svg"),
    ).not.toBeNull()
    expect(within(cards[0]).getByText("90%")).toBeInTheDocument()
    expect(within(cards[1]).getByText("82.5%")).toBeInTheDocument()
    expect(within(cards[0]).getByRole("time")).toHaveAttribute(
      "datetime",
      "2026-08-25T08:48:34.000Z",
    )
    expect(within(cards[0]).getByRole("time")).toHaveTextContent("Aug 25")
    expect(within(cards[0]).getByRole("time")).not.toHaveTextContent("2026")
    expect(
      within(cards[0]).getByRole("link", { name: "Review" }),
    ).toHaveAttribute("href", "/attempts/attempt-submitted/review")
    expect(
      within(cards[0]).getByRole("link", { name: "Result" }),
    ).toHaveAttribute("href", "/attempts/attempt-submitted/result")
    expect(
      screen.queryByText("No finished attempts yet."),
    ).not.toBeInTheDocument()
  })

  it("marks how each attempt ended without relying on colour alone", () => {
    renderHistory(firstPage)

    const [submitted, expired] = screen.getAllByRole("listitem")

    expect(within(submitted).getByText("Handed in")).toBeInTheDocument()
    expect(within(submitted).queryByText("Time ran out")).toBeNull()
    expect(
      within(expired).getByText("Time ran out").closest(".m-chip"),
    ).toHaveAttribute("data-ended", "expired")
    expect(within(expired).queryByText("Handed in")).toBeNull()
  })

  it("has no table and no drawer trigger any more", () => {
    renderHistory(firstPage)

    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.queryByRole("button", { name: "Open menu" })).toBeNull()
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

    expect(await screen.findByText("Practice Test 02")).toBeInTheDocument()
    expect(screen.getByText("Practice Test 04")).toBeInTheDocument()
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
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
    expect(terminalPagination).toHaveClass("m-btn")
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
    expect(screen.getByText("Practice Test 04")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled()
  })

  it("renders a useful empty state when there are no finished attempts", () => {
    renderHistory({ attempts: [], nextCursor: null })

    expect(screen.getByText("No finished attempts yet.")).toBeInTheDocument()
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
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
