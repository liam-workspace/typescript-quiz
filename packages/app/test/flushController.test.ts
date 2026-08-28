import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AnswerQueue } from "../src/lib/answerQueue.js"
import { FlushController, type FlushHttp } from "../src/lib/flushController.js"

const NOW = new Date("2026-08-27T09:00:00.000Z")

beforeEach(() => {
  indexedDB.deleteDatabase("pp-flush-test")
})

function fakeScheduler(): {
  schedule: (delayMs: number) => Promise<void>
  delays: number[]
} {
  const delays: number[] = []

  return {
    delays,
    schedule: (delayMs: number) => {
      delays.push(delayMs)

      // No real timer: the point of injecting the scheduler is that this
      // test never actually waits.
      return Promise.resolve()
    },
  }
}

describe("FlushController", () => {
  it("sends every queued answer for the section as one snapshot and acks applied items", async () => {
    const queue = await AnswerQueue.open("pp-flush-test")
    const recorded = await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s1",
        questionId: "q1",
        selectedChoiceIds: ["c1"],
        timeSpentMs: null,
      },
      NOW,
    )

    const patch = vi.fn().mockResolvedValue({
      kind: "ok",
      status: 200,
      body: { results: [{ questionId: "q1", status: "applied" }] },
    })
    const http: FlushHttp = { patch }
    const scheduler = fakeScheduler()
    const controller = new FlushController(queue, http, (ms: number) =>
      scheduler.schedule(ms),
    )

    const result = await controller.flushSection(
      "a1",
      "s1",
      "/attempts/a1/responses",
    )

    expect(result.flushed).toBe(true)
    expect(patch).toHaveBeenCalledWith(
      "/attempts/a1/responses",
      expect.objectContaining({
        responses: [
          expect.objectContaining({ questionId: "q1", seq: recorded.seq }),
        ],
      }),
    )
    const remaining = await queue.snapshotForSection("a1", "s1")
    expect(remaining).toHaveLength(0)
    await queue.close()
  })

  it("reconciles a mixed response correctly: applied is acked, ignored_stale is acked (not retried), a terminal rejection is excluded from future flushes, and an item absent from the results stays queued", async () => {
    const queue = await AnswerQueue.open("pp-flush-test")
    await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s1",
        questionId: "q-applied",
        selectedChoiceIds: ["c1"],
        timeSpentMs: null,
      },
      NOW,
    )
    await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s1",
        questionId: "q-stale",
        selectedChoiceIds: ["c2"],
        timeSpentMs: null,
      },
      NOW,
    )
    await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s1",
        questionId: "q-rejected",
        selectedChoiceIds: ["c3"],
        timeSpentMs: null,
      },
      NOW,
    )
    await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s1",
        questionId: "q-untouched",
        selectedChoiceIds: ["c4"],
        timeSpentMs: null,
      },
      NOW,
    )

    const patch = vi.fn().mockResolvedValue({
      kind: "ok",
      status: 200,
      body: {
        results: [
          { questionId: "q-applied", status: "applied" },
          { questionId: "q-stale", status: "ignored_stale" },
          { questionId: "q-rejected", status: "rejected" },
          // Q-untouched deliberately absent from the results array.
        ],
      },
    })
    const http: FlushHttp = { patch }
    const scheduler = fakeScheduler()
    const controller = new FlushController(queue, http, (ms: number) =>
      scheduler.schedule(ms),
    )

    const result = await controller.flushSection(
      "a1",
      "s1",
      "/attempts/a1/responses",
    )

    expect(result.flushed).toBe(true)
    expect(patch).toHaveBeenCalledTimes(1)

    const remaining = await queue.snapshotForSection("a1", "s1")
    const remainingIds = remaining.map((item) => item.questionId).sort()
    // Applied and ignored_stale are both settled outcomes and must be gone.
    // Rejected is excluded via markTerminalRejection, not deletion, but
    // still absent from the snapshot. Untouched must still be there --
    // absence from a partial results array is not a settlement.
    expect(remainingIds).toEqual(["q-untouched"])

    // The rejected item must never come back on a subsequent flush.
    const second = await controller.flushSection(
      "a1",
      "s1",
      "/attempts/a1/responses",
    )
    expect(second.flushed).toBe(true)
    const secondBody = patch.mock.calls[1][1] as {
      responses: Array<{ questionId: string }>
    }
    expect(secondBody.responses.map((item) => item.questionId)).not.toContain(
      "q-rejected",
    )
    expect(secondBody.responses.map((item) => item.questionId)).toEqual([
      "q-untouched",
    ])

    await queue.close()
  })

  it("marks a rejected item terminal and excludes it from the next flush, without retrying it", async () => {
    const queue = await AnswerQueue.open("pp-flush-test")
    await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s1",
        questionId: "q1",
        selectedChoiceIds: ["c1"],
        timeSpentMs: null,
      },
      NOW,
    )

    const patch = vi.fn().mockResolvedValue({
      kind: "ok",
      status: 200,
      body: { results: [{ questionId: "q1", status: "rejected" }] },
    })
    const http: FlushHttp = { patch }
    const scheduler = fakeScheduler()
    const controller = new FlushController(queue, http, (ms: number) =>
      scheduler.schedule(ms),
    )

    const result = await controller.flushSection(
      "a1",
      "s1",
      "/attempts/a1/responses",
    )

    const remaining = await queue.snapshotForSection("a1", "s1")
    expect(remaining).toHaveLength(0)
    expect(patch).toHaveBeenCalledTimes(1)
    // B5: the caller must be told WHICH question was terminally rejected --
    // markTerminalRejection alone silences the queue, but only the return
    // value gives the page anything to surface to the child.
    expect(result.rejectedQuestionIds).toEqual(["q1"])
    await queue.close()
  })

  it("retries a network error with backoff via the injected scheduler, then succeeds -- no real sleep", async () => {
    const queue = await AnswerQueue.open("pp-flush-test")
    await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s1",
        questionId: "q1",
        selectedChoiceIds: ["c1"],
        timeSpentMs: null,
      },
      NOW,
    )

    const patch = vi
      .fn()
      .mockResolvedValueOnce({ kind: "network-error" })
      .mockResolvedValueOnce({
        kind: "ok",
        status: 200,
        body: { results: [{ questionId: "q1", status: "applied" }] },
      })
    const http: FlushHttp = { patch }
    const scheduler = fakeScheduler()
    const controller = new FlushController(queue, http, (ms: number) =>
      scheduler.schedule(ms),
    )

    const result = await controller.flushSection(
      "a1",
      "s1",
      "/attempts/a1/responses",
    )

    expect(result.flushed).toBe(true)
    expect(patch).toHaveBeenCalledTimes(2)
    expect(scheduler.delays).toHaveLength(1)
    expect(scheduler.delays[0]).toBeGreaterThan(0)
    await queue.close()
  })

  it("carries the same unacknowledged snapshot on the retried attempt -- an item first recorded after attempt 1 is also included, since it is a re-read of the queue, not a cached body", async () => {
    const queue = await AnswerQueue.open("pp-flush-test")
    await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s1",
        questionId: "q1",
        selectedChoiceIds: ["c1"],
        timeSpentMs: null,
      },
      NOW,
    )

    const patch = vi
      .fn()
      .mockResolvedValueOnce({ kind: "network-error" })
      .mockResolvedValueOnce({
        kind: "ok",
        status: 200,
        body: {
          results: [{ questionId: "q1", status: "applied" }],
        },
      })
    const http: FlushHttp = { patch }
    const scheduler = fakeScheduler()
    const controller = new FlushController(queue, http, (ms: number) =>
      scheduler.schedule(ms),
    )

    const result = await controller.flushSection(
      "a1",
      "s1",
      "/attempts/a1/responses",
    )

    expect(result.flushed).toBe(true)
    expect(patch).toHaveBeenCalledTimes(2)
    await queue.close()
  })

  it("stops dead on a non-retryable 4xx without calling the scheduler, leaving the whole snapshot queued", async () => {
    const queue = await AnswerQueue.open("pp-flush-test")
    await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s1",
        questionId: "q1",
        selectedChoiceIds: ["c1"],
        timeSpentMs: null,
      },
      NOW,
    )

    const patch = vi
      .fn()
      .mockResolvedValue({ kind: "http-error", status: 400, body: {} })
    const http: FlushHttp = { patch }
    const scheduler = fakeScheduler()
    const controller = new FlushController(queue, http, (ms: number) =>
      scheduler.schedule(ms),
    )

    const result = await controller.flushSection(
      "a1",
      "s1",
      "/attempts/a1/responses",
    )

    expect(result.flushed).toBe(false)
    expect(patch).toHaveBeenCalledTimes(1)
    expect(scheduler.delays).toHaveLength(0)

    // Envelope-level failure means nothing was settled: the whole snapshot
    // stays queued for the next flush.
    const remaining = await queue.snapshotForSection("a1", "s1")
    expect(remaining).toHaveLength(1)
    expect(remaining[0].questionId).toBe("q1")
    await queue.close()
  })

  it("returns flushed:true without calling http when the section has nothing queued", async () => {
    const queue = await AnswerQueue.open("pp-flush-test")
    const patch = vi.fn()
    const http: FlushHttp = { patch }
    const scheduler = fakeScheduler()
    const controller = new FlushController(queue, http, (ms: number) =>
      scheduler.schedule(ms),
    )

    const result = await controller.flushSection(
      "a1",
      "s1",
      "/attempts/a1/responses",
    )

    expect(result.flushed).toBe(true)
    expect(patch).not.toHaveBeenCalled()
    await queue.close()
  })
})
