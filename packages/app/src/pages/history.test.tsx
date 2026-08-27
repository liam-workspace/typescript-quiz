import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { ApiError } from "../lib/api-client.js"
import type { AttemptHistoryPage } from "../lib/api-types.js"
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

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type":
        status >= 400 ? "application/problem+json" : "application/json",
    },
  })
}

describe("attempt history page", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("loads finished attempts with the contract's default page size", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(firstPage))
    vi.stubGlobal("fetch", fetchMock)

    const page = await loadHistory()

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/attempts?status=finished&limit=20",
    )
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()
    expect(page).toEqual(firstPage)
  })

  it("renders one row per finished attempt with its per-section and total scores", () => {
    render(<HistoryScreen initialPage={firstPage} />)

    const submittedRow = screen.getByRole("row", {
      name: /Practice Test 04/u,
    })
    const expiredRow = screen.getByRole("row", { name: /Practice Test 03/u })

    expect(screen.getAllByRole("row")).toHaveLength(3)
    expect(within(submittedRow).getAllByText("18 / 20")).toHaveLength(2)
    expect(within(submittedRow).getByText("36 / 40")).toBeInTheDocument()
    expect(within(submittedRow).getByText("90%")).toBeInTheDocument()
    expect(within(expiredRow).getByText("16 / 20")).toBeInTheDocument()
    expect(within(expiredRow).getByText("17 / 20")).toBeInTheDocument()
    expect(within(expiredRow).getByText("33 / 40")).toBeInTheDocument()
    expect(within(expiredRow).getByText("82.5%")).toBeInTheDocument()
    expect(within(submittedRow).getByRole("time")).toHaveAttribute(
      "datetime",
      "2026-08-25T08:48:34.000Z",
    )
    expect(
      within(submittedRow).getByRole("link", { name: "Review" }),
    ).toHaveAttribute("href", "/attempts/attempt-submitted/review")
    expect(
      screen.queryByText("No finished attempts yet."),
    ).not.toBeInTheDocument()
  })

  it("renders 'Time ran out' styling, not the ordinary 'Handed in' text, for a status: expired row", () => {
    render(<HistoryScreen initialPage={firstPage} />)

    const row = screen.getByRole("row", { name: /Practice Test 03/u })
    expect(within(row).getByText("Time ran out")).toHaveClass("text-amber-700")
    expect(within(row).queryByText("Handed in")).not.toBeInTheDocument()
  })

  it("renders ordinary 'Handed in' styling, not 'Time ran out', for a status: submitted row", () => {
    render(<HistoryScreen initialPage={firstPage} />)

    const row = screen.getByRole("row", { name: /Practice Test 04/u })
    expect(within(row).getByText("Handed in")).toHaveClass("text-stone-600")
    expect(within(row).queryByText("Time ran out")).not.toBeInTheDocument()
  })

  it("fetches the next page on Load more and appends rather than replaces the rows", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(lastPage))
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()
    render(<HistoryScreen initialPage={firstPage} />)

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
    render(<HistoryScreen initialPage={lastPage} />)

    expect(
      screen.getByRole("button", { name: "No older attempts" }),
    ).toBeDisabled()
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
    render(<HistoryScreen initialPage={firstPage} />)

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
    render(<HistoryScreen initialPage={firstPage} />)

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
    render(<HistoryScreen initialPage={{ attempts: [], nextCursor: null }} />)

    expect(screen.getByText("No finished attempts yet.")).toBeInTheDocument()
    expect(
      screen.queryByRole("row", { name: /Practice Test/u }),
    ).not.toBeInTheDocument()
  })

  it("marks a section as not included when another test establishes that column", () => {
    render(
      <HistoryScreen
        initialPage={{
          attempts: [
            firstPage.attempts[0],
            {
              ...lastPage.attempts[0],
              sections: [lastPage.attempts[0].sections[0]],
            },
          ],
          nextCursor: null,
        }}
      />,
    )

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
