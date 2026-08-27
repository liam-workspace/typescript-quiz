import "fake-indexeddb/auto"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { AnswerQueue } from "../lib/answerQueue.js"
import type { RunnerEnvelope } from "../lib/api-types.js"
import { HandInScreen } from "./attempts.$attemptId.hand-in.js"

const DB_NAME = "pp-answer-queue-handin-test"
const NOW = new Date("2026-08-27T09:00:00.000Z")

const baseEnvelope: RunnerEnvelope = {
  id: "attempt-1",
  status: "in_progress",
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

  it("disables Hand in while the local queue is non-empty", async () => {
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

      expect(await screen.findByTestId("hand-in-button")).toBeDisabled()
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
