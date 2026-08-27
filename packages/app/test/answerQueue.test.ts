import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"
import { AnswerQueue } from "../src/lib/answerQueue.js"

const NOW = new Date("2026-08-27T09:00:00.000Z")

beforeEach(() => {
  indexedDB.deleteDatabase("pp-answer-queue-test")
})

describe("AnswerQueue", () => {
  it("durable before sent: a recorded answer survives closing and reopening the queue", async () => {
    const queue = await AnswerQueue.open("pp-answer-queue-test")
    await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s1",
        questionId: "q1",
        selectedChoiceIds: ["c1"],
        timeSpentMs: 1000,
      },
      NOW,
    )
    await queue.close()

    // Simulates a crash before any network call ever completed -- nothing
    // in this test ever touched a network. The record must still be there
    // on the next open, because it was written to IndexedDB on tap, never
    // held only in memory pending a request.
    const reopened = await AnswerQueue.open("pp-answer-queue-test")
    const snapshot = await reopened.snapshotForSection("a1", "s1")
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0].questionId).toBe("q1")
    expect(snapshot[0].selectedChoiceIds).toEqual(["c1"])
    await reopened.close()
  })

  it("mints clientInstanceId once and it survives a reopen", async () => {
    const queue = await AnswerQueue.open("pp-answer-queue-test")
    const id = queue.clientInstanceId()
    await queue.close()

    const reopened = await AnswerQueue.open("pp-answer-queue-test")
    expect(reopened.clientInstanceId()).toBe(id)
    await reopened.close()
  })

  it("seq increases across attempts, not just within one -- Ordering, verbatim", async () => {
    const queue = await AnswerQueue.open("pp-answer-queue-test")
    const first = await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s1",
        questionId: "q1",
        selectedChoiceIds: ["c1"],
        timeSpentMs: null,
      },
      NOW,
    )
    const second = await queue.recordAnswer(
      {
        attemptId: "a2",
        sectionId: "s2",
        questionId: "q9",
        selectedChoiceIds: ["c9"],
        timeSpentMs: null,
      },
      NOW,
    )

    expect(second.seq).toBeGreaterThan(first.seq)
    await queue.close()
  })

  it("snapshotForSection carries every answer held for that section, not a delta", async () => {
    const queue = await AnswerQueue.open("pp-answer-queue-test")
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
    await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s1",
        questionId: "q2",
        selectedChoiceIds: ["c2"],
        timeSpentMs: null,
      },
      NOW,
    )
    // A different section must not appear in this section's snapshot.
    await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s2",
        questionId: "q3",
        selectedChoiceIds: ["c3"],
        timeSpentMs: null,
      },
      NOW,
    )

    const snapshot = await queue.snapshotForSection("a1", "s1")
    expect(snapshot.map((item) => item.questionId).sort()).toEqual(["q1", "q2"])
    await queue.close()
  })

  it("ackItem clears an item only when the ack is not older than the current local edit", async () => {
    const queue = await AnswerQueue.open("pp-answer-queue-test")
    const first = await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s1",
        questionId: "q1",
        selectedChoiceIds: ["c1"],
        timeSpentMs: null,
      },
      NOW,
    )
    // A newer local edit happens before the ack for the OLDER write arrives
    // -- e.g. a slow in-flight request's response lands after the child
    // already changed their answer again.
    const second = await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s1",
        questionId: "q1",
        selectedChoiceIds: ["c2"],
        timeSpentMs: null,
      },
      NOW,
    )
    expect(second.seq).toBeGreaterThan(first.seq)

    // Never cleared on request completion -- only on a per-item ack, and
    // only when that ack is not stale relative to what is queued NOW.
    await queue.ackItem("a1", "q1", first.seq)

    const snapshot = await queue.snapshotForSection("a1", "s1")
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0].selectedChoiceIds).toEqual(["c2"])

    // The correct ack, at the current seq, DOES clear it.
    await queue.ackItem("a1", "q1", second.seq)
    const afterRealAck = await queue.snapshotForSection("a1", "s1")
    expect(afterRealAck).toHaveLength(0)
    await queue.close()
  })

  it("markTerminalRejection excludes the item from future snapshots without deleting the queue's record of it", async () => {
    const queue = await AnswerQueue.open("pp-answer-queue-test")
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
    await queue.markTerminalRejection("a1", "q1")

    const snapshot = await queue.snapshotForSection("a1", "s1")
    expect(snapshot).toHaveLength(0)
    await queue.close()
  })

  it("clearing on envelope success rather than per-item ack is exactly the bug rule 1 prevents: an acked item is gone but an unacked sibling in the same flush survives", async () => {
    const queue = await AnswerQueue.open("pp-answer-queue-test")
    const acked = await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s1",
        questionId: "q1",
        selectedChoiceIds: ["c1"],
        timeSpentMs: null,
      },
      NOW,
    )
    await queue.recordAnswer(
      {
        attemptId: "a1",
        sectionId: "s1",
        questionId: "q2",
        selectedChoiceIds: ["c2"],
        timeSpentMs: null,
      },
      NOW,
    )

    // Simulates a snapshot flush's 200 envelope where the per-item results
    // say q1 was applied but q2 was rejected (or simply never included in
    // per-item results yet). Only the acked item may be cleared -- clearing
    // both because the HTTP request as a whole came back 200 is the bug
    // rule 1 exists to prevent.
    await queue.ackItem("a1", "q1", acked.seq)

    const snapshot = await queue.snapshotForSection("a1", "s1")
    expect(snapshot.map((item) => item.questionId)).toEqual(["q2"])
    await queue.close()
  })
})
