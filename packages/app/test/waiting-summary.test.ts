import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AnswerQueue } from "../src/lib/answerQueue.js"
import { getAttemptRuntime } from "../src/lib/attempt/runtime.js"
import {
  loadWaitingSummary,
  summarizeWaiting,
} from "../src/lib/attempt/waiting-summary.js"
import { makeLocalState } from "./helpers/local-state-fixture.js"

const owner = vi.hoisted(() => ({ sub: "sub-1" as string | null }))

vi.mock("../src/lib/attempt/owner.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/attempt/owner.js")>()),
  currentSubject: () => owner.sub,
}))

describe("summarizeWaiting", () => {
  it("counts answered questions against the test's total", () => {
    const summary = summarizeWaiting(
      makeLocalState(),
      new Set(["q-l1", "q-r1"]),
    )

    expect(summary).toEqual({
      testTitle: "Practice Test 3",
      answeredCount: 2,
      unansweredCount: 1,
    })
  })

  it("never reports more answered than there are questions", () => {
    const summary = summarizeWaiting(
      makeLocalState(),
      new Set(["a", "b", "c", "d", "e"]),
    )

    expect(summary).toMatchObject({ answeredCount: 3, unansweredCount: 0 })
  })
})

describe("loadWaitingSummary", () => {
  beforeEach(async () => {
    owner.sub = "sub-1"

    const { journal } = await getAttemptRuntime()

    await Promise.all(
      (await journal.listAttempts()).map((a) =>
        journal.deleteAttempt(a.attemptId),
      ),
    )
  })

  async function unsent(over: Parameters<typeof makeLocalState>[0] = {}) {
    const { journal } = await getAttemptRuntime()

    await journal.putAttempt(makeLocalState(over))
    await journal.append("att-1", {
      type: "start",
      clientAt: "2026-11-22T11:00:00.000Z",
      payload: {},
    })

    return journal
  }

  it("is null for an attempt this device has never held", async () => {
    expect(await loadWaitingSummary("att-1")).toBeNull()
  })

  it("describes the student's own attempt while it holds unsent events", async () => {
    await unsent()

    const queue = await AnswerQueue.open()

    await queue.recordAnswer(
      {
        attemptId: "att-1",
        sectionId: "sec-l",
        questionId: "q-l1",
        selectedChoiceIds: ["a"],
        timeSpentMs: null,
      },
      new Date("2026-11-22T11:00:00.000Z"),
    )
    await queue.close()

    expect(await loadWaitingSummary("att-1")).toEqual({
      testTitle: "Practice Test 3",
      answeredCount: 1,
      unansweredCount: 2,
    })
  })

  it("is null for ANOTHER student's attempt on a shared phone", async () => {
    await unsent({ ownerSub: "sub-2" })

    expect(await loadWaitingSummary("att-1")).toBeNull()
  })

  it("is null when nobody is signed in", async () => {
    await unsent()
    owner.sub = null

    expect(await loadWaitingSummary("att-1")).toBeNull()
  })

  it("is null for a server-known attempt with nothing pending", async () => {
    const journal = await unsent({ serverKnown: true })

    await journal.markSynced("att-1", 1)

    expect(await loadWaitingSummary("att-1")).toBeNull()
  })

  it("still describes a server-known attempt whose journal was refused (kept, not purged)", async () => {
    const journal = await unsent({ serverKnown: true })

    await journal.markSynced("att-1", 1)
    await journal.update("att-1", (s) => ({
      ...s,
      syncError: "offline_sync_rejected",
    }))

    expect(await loadWaitingSummary("att-1")).not.toBeNull()
  })

  const response = (questionId: string, selectedChoiceIds: string[]) => ({
    questionId,
    selectedChoiceIds,
    clientInstanceId: "c",
    seq: 1,
  })

  async function queued(ids: Array<[string, string[]]>) {
    const queue = await AnswerQueue.open()

    await Promise.all(
      ids.map(([questionId, selectedChoiceIds]) =>
        queue.recordAnswer(
          {
            attemptId: "att-1",
            sectionId: "sec-l",
            questionId,
            selectedChoiceIds,
            timeSpentMs: null,
          },
          new Date("2026-11-22T11:00:00.000Z"),
        ),
      ),
    )

    await queue.close()
  }

  it("counts answers the server already accepted (acked out of the queue, kept in the local state)", async () => {
    await unsent({
      serverKnown: true,
      responses: [response("q-l1", ["a"]), response("q-l2", ["a"])],
    })

    expect(await loadWaitingSummary("att-1")).toMatchObject({
      answeredCount: 2,
      unansweredCount: 1,
    })
  })

  it("an offline-started attempt counts from the queue alone", async () => {
    await unsent()
    await queued([["q-l1", ["a"]]])

    expect(await loadWaitingSummary("att-1")).toMatchObject({
      answeredCount: 1,
      unansweredCount: 2,
    })
  })

  it("a question in both the state and the queue is counted once", async () => {
    await unsent({
      serverKnown: true,
      responses: [response("q-l1", ["a"])],
    })
    await queued([
      ["q-l1", ["b"]],
      ["q-r1", ["a"]],
    ])

    expect(await loadWaitingSummary("att-1")).toMatchObject({
      answeredCount: 2,
      unansweredCount: 1,
    })
  })

  it("a cleared selection (empty array) is unanswered", async () => {
    await unsent({
      serverKnown: true,
      responses: [response("q-l1", ["a"]), response("q-l2", [])],
    })
    await queued([["q-l1", []]])

    expect(await loadWaitingSummary("att-1")).toMatchObject({
      answeredCount: 1,
      unansweredCount: 2,
    })
  })
})
