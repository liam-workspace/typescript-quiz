import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  defaultParseSearch,
  defaultStringifySearch,
} from "@tanstack/react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { ApiError } from "../lib/api-client.js"
import { startAttempt } from "../lib/attempts-api.js"
import type { AttemptStart, TestBrief } from "../lib/api-types.js"
import {
  TestBriefRouteError,
  TestBriefScreen,
  loadTestBrief,
} from "./tests.$slug.js"

vi.mock("../lib/attempts-api.js", () => ({
  startAttempt: vi.fn(),
}))

const mockStartAttempt = vi.mocked(startAttempt)

const brief: TestBrief = {
  id: "test-04",
  slug: "primary-practice-04",
  title: "Practice Test 04",
  level: "primary-step-1",
  durationSeconds: 3000,
  attemptCount: 0,
  inProgressAttemptId: null,
  sections: [
    {
      id: "section-listening",
      type: "listening",
      title: "Listening",
      ordinal: 1,
      questionCount: 20,
      durationSeconds: 1500,
      navigation: "forward_only",
      allowAnswerChange: false,
      playback: { maxPlays: 1, allowPause: false, allowSeek: false },
      instructions: [
        "Each recording plays once.",
        "You cannot go back to an earlier question.",
      ],
    },
    {
      id: "section-reading",
      type: "reading",
      title: "Reading",
      ordinal: 2,
      questionCount: 18,
      durationSeconds: 1320,
      navigation: "free",
      allowAnswerChange: true,
      playback: null,
      instructions: [
        "Read each passage as often as you like.",
        "You can change an answer before handing in.",
      ],
    },
  ],
}

const startedAttempt: AttemptStart = {
  id: "attempt-authoritative",
  attemptNumber: 3,
  status: "in_progress",
  createdAt: "2026-08-28T09:00:00.000Z",
  startedAt: null,
  expiresAt: null,
  serverTime: "2026-08-28T09:00:00.100Z",
  resumed: false,
  currentSectionId: null,
  currentQuestionId: null,
  finalizedPriorAttempt: null,
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => {
    throw new Error("deferred promise was not initialized")
  }
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })

  return { promise, resolve: resolvePromise }
}

describe("test brief page", () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("loads the brief without starting an attempt", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(brief))
    vi.stubGlobal("fetch", fetchMock)

    const loaded = await loadTestBrief(brief.slug)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/tests/primary-practice-04")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()
    expect(loaded).toEqual(brief)
  })

  it("renders the test facts, optimistic attempt number, and every section's own rules", () => {
    render(<TestBriefScreen brief={brief} navigate={vi.fn()} />)

    expect(
      screen.getByRole("heading", { level: 1, name: "Practice Test 04" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Step 1 · Two sections · 50 minutes · Attempt 1 of this test",
      ),
    ).toBeInTheDocument()

    const listening = screen.getByRole("article", { name: "Listening" })
    expect(within(listening).getByText("20 questions")).toBeInTheDocument()
    expect(within(listening).getByText("25 min")).toBeInTheDocument()
    expect(
      within(listening).getByText("Each recording plays once."),
    ).toBeInTheDocument()
    expect(
      within(listening).getByText("You cannot go back to an earlier question."),
    ).toBeInTheDocument()

    const reading = screen.getByRole("article", { name: "Reading" })
    expect(within(reading).getByText("18 questions")).toBeInTheDocument()
    expect(within(reading).getByText("22 min")).toBeInTheDocument()
    expect(
      within(reading).getByText("Read each passage as often as you like."),
    ).toBeInTheDocument()
    expect(
      within(reading).getByText("You can change an answer before handing in."),
    ).toBeInTheDocument()
    expect(
      within(reading).queryByText("Each recording plays once."),
    ).not.toBeInTheDocument()
  })

  it("renders a readable 404 with a way back to the library", () => {
    render(
      <TestBriefRouteError
        error={
          new ApiError({
            type: "not_found",
            title: "Not found",
            status: 404,
          })
        }
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This test is not available.",
    )
    expect(
      screen.getByRole("link", { name: "Back to test library" }),
    ).toHaveAttribute("href", "/")
  })

  it("starts once and navigates to the first section's rules with the returned attempt id", async () => {
    mockStartAttempt.mockResolvedValue(startedAttempt)
    const navigate = vi.fn()
    const user = userEvent.setup()
    render(<TestBriefScreen brief={brief} navigate={navigate} />)

    await user.click(screen.getByRole("button", { name: "Start test" }))

    expect(mockStartAttempt).toHaveBeenCalledExactlyOnceWith(brief.slug)
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      "/attempts/attempt-authoritative/sections/section-listening/rules",
    )
    expect(startedAttempt.startedAt).toBeNull()
    expect(startedAttempt.expiresAt).toBeNull()
  })

  it("uses the lowest section ordinal when the response order changes", async () => {
    mockStartAttempt.mockResolvedValue(startedAttempt)
    const navigate = vi.fn()
    const user = userEvent.setup()
    render(
      <TestBriefScreen
        brief={{ ...brief, sections: [...brief.sections].reverse() }}
        navigate={navigate}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Start test" }))

    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      "/attempts/attempt-authoritative/sections/section-listening/rules",
    )
  })

  it("guards a rapid double press so the screen sends only one start request", async () => {
    const pendingStart = deferred<AttemptStart>()
    mockStartAttempt.mockReturnValue(pendingStart.promise)
    const user = userEvent.setup()
    render(<TestBriefScreen brief={brief} navigate={vi.fn()} />)

    await user.dblClick(screen.getByRole("button", { name: "Start test" }))

    expect(mockStartAttempt).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled()
    pendingStart.resolve(startedAttempt)
  })

  it("carries finalizedPriorAttempt to the section-rules screen instead of swallowing it", async () => {
    const finalizedPriorAttempt = {
      id: "attempt-stale",
      status: "expired" as const,
      submittedAt: "2026-08-28T08:50:00.000Z",
      resultUrl: "/attempts/attempt-stale/result",
    }
    mockStartAttempt.mockResolvedValue({
      ...startedAttempt,
      finalizedPriorAttempt,
    })
    const navigate = vi.fn()
    const user = userEvent.setup()
    render(<TestBriefScreen brief={brief} navigate={navigate} />)

    await user.click(screen.getByRole("button", { name: "Start test" }))

    const expectedSearch = defaultStringifySearch({ finalizedPriorAttempt })
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      `/attempts/attempt-authoritative/sections/section-listening/rules${expectedSearch}`,
    )
    expect(defaultParseSearch(expectedSearch)).toEqual({
      finalizedPriorAttempt,
    })
  })

  it("shows a readable error and allows retry when starting fails", async () => {
    mockStartAttempt.mockRejectedValue(
      new ApiError({
        type: "start_unavailable",
        title: "Unavailable",
        status: 503,
      }),
    )
    const user = userEvent.setup()
    render(<TestBriefScreen brief={brief} navigate={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "Start test" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The test could not be started. Please try again.",
    )
    expect(screen.getByRole("button", { name: "Start test" })).toBeEnabled()
  })
})
