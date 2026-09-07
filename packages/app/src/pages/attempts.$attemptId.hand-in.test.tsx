import "fake-indexeddb/auto"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { isRedirect } from "@tanstack/react-router"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest"
import "../i18n.js"
import { AnswerQueue } from "../lib/answerQueue.js"
import type { RunnerEnvelope } from "../lib/api-types.js"
import {
  HandInRouteError,
  HandInScreen,
  loadHandInRouteData,
} from "./attempts.$attemptId.hand-in.js"

const DB_NAME = "pp-answer-queue-handin-test"
const NOW = new Date("2026-08-27T09:00:00.000Z")

// Top-level, not inline: a named function passed by reference (rather than
// an arrow written at the call site) adds no callback-nesting depth at the
// describe/beforeEach/it it is used from -- see `loadHandInRouteData /
// HandInRouteError`'s `beforeEach` below, which is already several levels
// deep before this is even involved.
function closeQueue(queue: AnswerQueue): Promise<void> {
  return queue.close()
}

// `loadHandInRouteData("attempt-1").catch(...)` below needs the rejection
// VALUE, not to re-throw it -- `(error: unknown) => error` inline would add
// a callback nesting level at that call site.
function asRejectionValue(error: unknown): unknown {
  return error
}

/**
 * `loadHandInRouteData` opens a REAL AnswerQueue (fake-indexeddb-backed,
 * default DB name -- distinct from this file's own `DB_NAME`) alongside the
 * envelope fetch, per its own doc comment, even when the envelope half
 * rejects and the queue is never handed back to the caller to close. Left
 * open, that connection is exactly the kind of dangling handle that made
 * fake-indexeddb's shared, cross-file job queue flaky for unrelated later
 * tests. This wraps `AnswerQueue.open` to capture every instance it mints
 * into `sink`, so the describe block's own `afterEach` can close them --
 * fixing the test's hygiene rather than changing `loadHandInRouteData`'s
 * production behaviour just to suit it.
 */
function trackingOpener(
  original: (name?: string) => Promise<AnswerQueue>,
  sink: AnswerQueue[],
): (name?: string) => Promise<AnswerQueue> {
  return async function tracked(name?: string): Promise<AnswerQueue> {
    const opened = await original(name)

    sink.push(opened)

    return opened
  }
}

const baseEnvelope: RunnerEnvelope = {
  id: "attempt-1",
  status: "in_progress",
  attemptNumber: 1,
  testTitle: "Practice Test 04",
  expiresAt: "2026-08-27T09:30:00.000Z",
  serverTime: "2026-08-27T09:00:00.000Z",
  questionCount: 40,
  answeredCount: 38,
  unansweredOrdinals: [12, 31],
  currentSectionId: "section-1",
  currentQuestionId: "q-1",
  sections: [],
  responses: [],
}

beforeEach(() => {
  indexedDB.deleteDatabase(DB_NAME)
})

describe("HandInScreen", () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("uses the confirmation-screen hierarchy for live answer counts", async () => {
    const queue = await AnswerQueue.open(DB_NAME)

    try {
      render(
        <HandInScreen
          attemptId="attempt-1"
          envelope={baseEnvelope}
          queue={queue}
          navigate={vi.fn()}
        />,
      )

      expect(screen.getByText(baseEnvelope.testTitle).closest("header")).toHaveClass(
        "app-bar",
      )
      expect(
        screen.getByRole("heading", { level: 1, name: "Hand in your test?" }),
      ).toHaveClass("screen-title")
      expect(screen.getByText(/still blank/i)).toHaveClass("notice")
      expect(screen.getByText("Answered").parentElement).toHaveClass(
        "summary-row",
      )
      expect(screen.getByText("Answered").closest("section")).toHaveClass(
        "device-card",
      )
      expect(screen.getByTestId("hand-in-button").closest("footer")).toHaveClass(
        "device-footer",
      )
    } finally {
      await queue.close()
    }
  })

  // Defect B4: this test used to pin the OPPOSITE assertion --
  // `toBeDisabled()` -- as correct. That made it the smoking gun for the
  // bug the external review found: `buildSubmitRemainder` already reads the
  // queue LIVE at submit time and the server's own `POST /submit` already
  // carries and applies that remainder atomically (`reconcileFinalFlush`
  // below; openapi.yaml's `finalFlush`), so gating the BUTTON on the same
  // queue being empty is pure redundancy that turns into real harm the
  // moment a flush never lands (offline, a slow network, a server hiccup):
  // the button is disabled by a snapshot taken once on mount and never
  // rechecked, so "Waiting…" never goes away and the child cannot use the
  // atomic path the server was built for. Hand-in must let submit carry the
  // remainder rather than block on it.
  it("keeps Hand in enabled even while the local queue is non-empty -- submit carries the remainder", async () => {
    const queue = await AnswerQueue.open(DB_NAME)

    try {
      await queue.recordAnswer(
        {
          attemptId: "attempt-1",
          sectionId: "section-1",
          questionId: "q-1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )

      render(
        <HandInScreen
          attemptId="attempt-1"
          envelope={baseEnvelope}
          queue={queue}
          navigate={vi.fn()}
        />,
      )

      await vi.waitFor(() => {
        expect(screen.getByTestId("hand-in-button")).toBeEnabled()
      })

      // The child is still told a sync is in flight -- this is informational
      // now, not a block.
      expect(
        await screen.findByRole("status", {}, { timeout: 2000 }),
      ).toHaveTextContent("Waiting for your last answers to save")
    } finally {
      await queue.close()
    }
  })

  it("enables Hand in once the local queue is empty for this attempt", async () => {
    const queue = await AnswerQueue.open(DB_NAME)

    try {
      render(
        <HandInScreen
          attemptId="attempt-1"
          envelope={baseEnvelope}
          queue={queue}
          navigate={vi.fn()}
        />,
      )

      await vi.waitFor(() => {
        expect(screen.getByTestId("hand-in-button")).toBeEnabled()
      })
    } finally {
      await queue.close()
    }
  })

  it("calls submit with the drained remainder and navigates to the result screen on success", async () => {
    const queue = await AnswerQueue.open(DB_NAME)

    try {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            attemptId: "attempt-1",
            status: "submitted",
            submittedAt: "2026-08-27T09:05:00.000Z",
            resultUrl: "/attempts/attempt-1/result",
            finalFlush: [{ questionId: "q-9", status: "applied" }],
          }),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      vi.stubGlobal("fetch", fetchMock)

      const navigate = vi.fn()
      const user = userEvent.setup()

      render(
        <HandInScreen
          attemptId="attempt-1"
          envelope={baseEnvelope}
          queue={queue}
          navigate={navigate}
        />,
      )

      const button = await screen.findByTestId("hand-in-button")
      await vi.waitFor(() => {
        expect(button).toBeEnabled()
      })

      // Simulates spec S5 rule 6's narrower race: an answer lands in the
      // queue AFTER the client's "is it empty" guard already found it empty
      // (the button above is enabled) but BEFORE the submit request is
      // actually sent. buildSubmitRemainder reads the queue live at call
      // time, so this must still ride the submit body.
      await queue.recordAnswer(
        {
          attemptId: "attempt-1",
          sectionId: "section-1",
          questionId: "q-9",
          selectedChoiceIds: ["c9"],
          timeSpentMs: 4000,
        },
        NOW,
      )

      await user.click(button)

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled()
      })

      const [[url, init]] = fetchMock.mock.calls
      expect(url).toBe("/api/attempts/attempt-1/submit")
      expect(init?.method).toBe("POST")

      // The load-bearing assertion: the request body must carry the
      // queue's remainder, not merely exist. A submit that silently sent
      // `{ responses: [] }` would still pass every check above this one.
      const sentBody = JSON.parse(init?.body as string) as {
        clientInstanceId: string
        responses: Array<{ questionId: string; selectedChoiceIds: string[] }>
      }
      expect(sentBody.clientInstanceId).toBe(queue.clientInstanceId())
      expect(sentBody.responses).toHaveLength(1)
      expect(sentBody.responses[0].questionId).toBe("q-9")
      expect(sentBody.responses[0].selectedChoiceIds).toEqual(["c9"])

      await vi.waitFor(() => {
        expect(navigate).toHaveBeenCalledExactlyOnceWith(
          "/attempts/attempt-1/result",
        )
      })

      // The finalFlush ack must reconcile the local queue -- the response
      // the client can clear its queue from alone, per openapi.yaml.
      const remaining = await queue.snapshotForAttempt("attempt-1")
      expect(remaining).toHaveLength(0)
    } finally {
      await queue.close()
    }
  })

  it("treats a 200 (already submitted) response as success, not an error", async () => {
    const queue = await AnswerQueue.open(DB_NAME)

    try {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            attemptId: "attempt-1",
            status: "submitted",
            submittedAt: "2026-08-27T09:05:00.000Z",
            resultUrl: "/attempts/attempt-1/result",
            finalFlush: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      vi.stubGlobal("fetch", fetchMock)

      const navigate = vi.fn()
      const user = userEvent.setup()

      render(
        <HandInScreen
          attemptId="attempt-1"
          envelope={baseEnvelope}
          queue={queue}
          navigate={navigate}
        />,
      )

      const button = await screen.findByTestId("hand-in-button")
      await vi.waitFor(() => {
        expect(button).toBeEnabled()
      })

      await user.click(button)

      await vi.waitFor(() => {
        expect(navigate).toHaveBeenCalledExactlyOnceWith(
          "/attempts/attempt-1/result",
        )
      })

      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    } finally {
      await queue.close()
    }
  })

  it("renders the time-up screen, not an error toast, when submit responds 410", async () => {
    const queue = await AnswerQueue.open(DB_NAME)

    try {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: "attempt_expired",
            title: "The attempt was past its deadline and has been finalized.",
            status: 410,
            attempt: {
              id: "attempt-1",
              status: "expired",
              submittedAt: "2026-08-27T09:30:00.000Z",
              resultUrl: "/attempts/attempt-1/result",
            },
          }),
          {
            status: 410,
            headers: { "content-type": "application/problem+json" },
          },
        ),
      )
      vi.stubGlobal("fetch", fetchMock)

      const navigate = vi.fn()
      const user = userEvent.setup()

      render(
        <HandInScreen
          attemptId="attempt-1"
          envelope={baseEnvelope}
          queue={queue}
          navigate={navigate}
        />,
      )

      const button = await screen.findByTestId("hand-in-button")
      await vi.waitFor(() => {
        expect(button).toBeEnabled()
      })

      await user.click(button)

      expect(
        await screen.findByText(
          "Your test time ran out. Your answers have been submitted.",
        ),
      ).toBeInTheDocument()
      expect(screen.getByRole("link", { name: "View result" })).toHaveAttribute(
        "href",
        "/attempts/attempt-1/result",
      )
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      expect(navigate).not.toHaveBeenCalled()
    } finally {
      await queue.close()
    }
  })

  it("uses the finalized result counts when a queued answer is accepted as submit expires", async () => {
    const queue = await AnswerQueue.open(DB_NAME)

    try {
      await queue.recordAnswer(
        {
          attemptId: "attempt-1",
          sectionId: "section-1",
          questionId: "q-9",
          selectedChoiceIds: ["c9"],
          timeSpentMs: 4_000,
        },
        NOW,
      )

      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              type: "attempt_expired",
              title: "The attempt was past its deadline and has been finalized.",
              status: 410,
              attempt: {
                id: "attempt-1",
                status: "expired",
                submittedAt: "2026-08-27T09:30:00.000Z",
                resultUrl: "/attempts/attempt-1/result",
              },
            }),
            {
              status: 410,
              headers: { "content-type": "application/problem+json" },
            },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              attemptId: "attempt-1",
              test: { title: "Practice Test 04", version: 2 },
              status: "expired",
              submittedAt: "2026-08-27T09:30:00.000Z",
              elapsedSeconds: 1_800,
              score: {
                pointsEarned: 0,
                pointsPossible: 40,
                percentage: 0,
                answered: 39,
                unanswered: 1,
                correct: 0,
                incorrect: 39,
                isPersonalBest: false,
                sections: [],
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        )
      vi.stubGlobal("fetch", fetchMock)

      const user = userEvent.setup()

      render(
        <HandInScreen
          attemptId="attempt-1"
          envelope={baseEnvelope}
          queue={queue}
          navigate={vi.fn()}
        />,
      )

      await user.click(await screen.findByTestId("hand-in-button"))

      const answered = await screen.findByText("Answered")
      expect(answered.parentElement).toHaveTextContent("39")
      expect(screen.getByText("Left blank").parentElement).toHaveTextContent(
        "1",
      )
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/attempts/attempt-1/result")
    } finally {
      await queue.close()
    }
  })

  it("shows a nothing-answered notice, not a crash, on a 409", async () => {
    const queue = await AnswerQueue.open(DB_NAME)

    try {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: "nothing_answered",
            title: "Nothing was answered.",
            status: 409,
          }),
          {
            status: 409,
            headers: { "content-type": "application/problem+json" },
          },
        ),
      )
      vi.stubGlobal("fetch", fetchMock)

      const navigate = vi.fn()
      const user = userEvent.setup()

      render(
        <HandInScreen
          attemptId="attempt-1"
          envelope={{
            ...baseEnvelope,
            answeredCount: 0,
            unansweredOrdinals: [],
          }}
          queue={queue}
          navigate={navigate}
        />,
      )

      const button = await screen.findByTestId("hand-in-button")
      await vi.waitFor(() => {
        expect(button).toBeEnabled()
      })

      await user.click(button)

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Nothing answered yet",
      )
      expect(navigate).not.toHaveBeenCalled()
    } finally {
      await queue.close()
    }
  })
})

// Defect A: hand-in.tsx had no errorComponent either -- same missing
// boundary as run.tsx, same fix shape. See run.test.tsx's matching describe
// for the full rationale.
describe("loadHandInRouteData / HandInRouteError", () => {
  const openedQueues: AnswerQueue[] = []
  let openSpy: MockInstance | undefined = undefined

  beforeEach(() => {
    // Captured BEFORE `spyOn` runs -- see run.test.tsx's matching
    // `beforeEach` for why: reading `AnswerQueue.open` afterwards would
    // capture the spy itself, not the real implementation, and `tracked`
    // calling "the original" would then call itself, infinitely.
    const originalOpen = AnswerQueue.open.bind(AnswerQueue)

    openSpy = vi
      .spyOn(AnswerQueue, "open")
      .mockImplementation(trackingOpener(originalOpen, openedQueues))
  })

  afterEach(async () => {
    cleanup()
    vi.unstubAllGlobals()
    openSpy?.mockRestore()
    await Promise.all(openedQueues.splice(0).map(closeQueue))
  })

  it("redirects to the result screen on a 410 attempt_expired, rather than erroring", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: "attempt_expired",
            title: "The attempt was past its deadline and has been finalized.",
            status: 410,
            attempt: {
              id: "attempt-1",
              status: "expired",
              submittedAt: "2026-08-27T09:25:00.000Z",
              resultUrl: "/attempts/attempt-1/result",
            },
          }),
          {
            status: 410,
            headers: { "content-type": "application/problem+json" },
          },
        ),
      ),
    )

    const thrown: unknown =
      await loadHandInRouteData("attempt-1").catch(asRejectionValue)

    expect(isRedirect(thrown)).toBe(true)

    if (!isRedirect(thrown)) {
      throw new Error("Expected a TanStack Router redirect")
    }

    expect(thrown.options.href).toBe("/attempts/attempt-1/result")
  })

  it("propagates a plain network failure for HandInRouteError to render", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")),
    )

    await expect(loadHandInRouteData("attempt-1")).rejects.toBeInstanceOf(
      TypeError,
    )
  })

  it("renders an honest, actionable message -- reassures answers are safe, offers a retry", () => {
    render(<HandInRouteError error={new TypeError("Failed to fetch")} />)

    expect(screen.getByRole("alert")).toHaveTextContent("Nothing is lost")
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument()
  })

  it("reloads the page rather than losing queued answers on a silent client-side retry", async () => {
    const reload = vi.fn()
    // Not `{ ...window.location, reload }`: `Location` is a class instance,
    // and spreading one loses its prototype (oxlint's `no-misused-spread`).
    // HandInRouteError's retry button only ever calls
    // `window.location.reload()`, so a minimal stand-in is both enough and
    // honest about what this test actually exercises.
    vi.stubGlobal("location", { reload })
    const user = userEvent.setup()

    render(<HandInRouteError error={new TypeError("Failed to fetch")} />)
    await user.click(screen.getByRole("button", { name: "Try again" }))

    expect(reload).toHaveBeenCalledOnce()
  })
})
