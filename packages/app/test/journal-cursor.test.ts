import "fake-indexeddb/auto"
import { describe, expect, it, vi } from "vitest"
import { AnswerQueue } from "../src/lib/answerQueue.js"
import type { RunnerEnvelope } from "../src/lib/api-types.js"
import { JournalStore } from "../src/lib/attempt/journal-store.js"
import {
  createJournalSync,
  type OfflineSyncBody,
  type OfflineSyncResponse,
} from "../src/lib/attempt/journal-sync.js"
import { HybridAttemptGateway } from "../src/lib/attempt/hybrid-gateway.js"
import { LocalAttemptGateway } from "../src/lib/attempt/local-gateway.js"
import { RemoteAttemptGateway } from "../src/lib/attempt/remote-gateway.js"
import { buildSectionFinishRemainder } from "../src/lib/lifecycleFlush.js"
import { createSyncStatusStore } from "../src/lib/attempt/sync-status.js"
import { makeBundle } from "./helpers/bundle-fixture.js"
import { makeLocalState } from "./helpers/local-state-fixture.js"

const T0 = Date.parse("2026-11-22T11:00:00.000Z")
const iso = (ms: number): string => new Date(ms).toISOString()
let n = 0

/**
 * The server's cursor rule (offline-sync.service): events at or below the
 * cursor are skipped, the rest applied, and `ackedThrough` is
 * max(cursor, last seq sent).
 */
function cursorServer(cursor: { v: number }) {
  return vi.fn((body: OfflineSyncBody): Promise<OfflineSyncResponse> => {
    const fresh = body.events.filter((e) => e.eventSeq > cursor.v)
    const last = body.events.at(-1)?.eventSeq ?? 0

    cursor.v = Math.max(cursor.v, last)

    return Promise.resolve({
      attemptId: body.attemptId,
      ackedThrough: cursor.v,
      applied: fresh.length,
      late: 0,
      rejected: 0,
      answersAcked: fresh.filter((e) => e.type === "answer").length,
      finalized: null,
    })
  })
}

function serverEnvelope(cursor: number): RunnerEnvelope {
  return {
    id: "srv-1",
    status: "in_progress",
    attemptNumber: 1,
    testTitle: "Practice Test 3",
    expiresAt: iso(T0 + 1_200_000),
    serverTime: iso(T0),
    questionCount: 3,
    answeredCount: 0,
    unansweredOrdinals: [1, 2, 3],
    currentSectionId: "sec-l",
    currentQuestionId: "q-l1",
    sections: makeLocalState().sections.map((s) =>
      s.id === "sec-l"
        ? { ...s, status: "open" as const, expiresAt: iso(T0 + 600_000) }
        : s,
    ),
    responses: [],
    offlineJournalCursor: cursor,
  }
}

async function setup() {
  n += 1
  const journal = await JournalStore.open(`pp-cursor-${n}`)
  const queueName = `pp-cursor-q-${n}`
  const queue = await AnswerQueue.open(queueName)
  const bundle = makeBundle()
  const local = new LocalAttemptGateway({
    journal,
    clock: { nowMs: () => T0 },
    bundles: {
      list: () => Promise.resolve([]),
      getBundle: () => Promise.resolve(bundle),
      getMediaBlob: () => Promise.resolve(null),
    },
    newId: () => "att-1",
    objectUrl: () => "blob:x",
    requestSync: () => undefined,
    ownerSub: () => "sub-1",
  })
  const sync = (post: (b: OfflineSyncBody) => Promise<OfflineSyncResponse>) =>
    createJournalSync({
      journal,
      post,
      openQueue: () => AnswerQueue.open(queueName),
      scheduler: () => Promise.resolve(),
      clockNow: () => T0,
      isOnline: () => true,
      currentSub: () => "sub-1",
      onSynced: () => undefined,
      status: createSyncStatusStore(),
    })

  return { journal, queue, local, sync }
}

async function answerOffline(
  local: LocalAttemptGateway,
  queue: AnswerQueue,
): Promise<void> {
  const queued = await queue.recordAnswer(
    {
      attemptId: "srv-1",
      sectionId: "sec-l",
      questionId: "q-l2",
      selectedChoiceIds: ["c-l2a"],
      timeSpentMs: null,
    },
    new Date(T0),
  )

  await local.setPosition("srv-1", "sec-l", "q-l2")
  await local.noteAnswer("srv-1", queued)
}

describe("journal cursor of a re-hydrated attempt (no local row, server cursor N)", () => {
  it("continues the journal after the server's cursor, so every new event is applied", async () => {
    const { journal, queue, local, sync } = await setup()
    const cursor = { v: 5 }
    const post = cursorServer(cursor)

    await local.hydrate(serverEnvelope(5))
    await answerOffline(local, queue)

    expect((await sync(post).syncNow("srv-1")).kind).toBe("synced")

    const sent = post.mock.calls.flatMap(([body]) => body.events)

    expect(sent.map((e) => e.eventSeq)).toEqual([6, 7])
    await expect(post.mock.results[0]?.value).resolves.toMatchObject({
      applied: 2,
    })
    expect(await journal.pendingCount("srv-1")).toBe(0)
    expect(await queue.snapshotForAttempt("srv-1")).toEqual([])
  })

  it("defence in depth: an ack beyond what was sent keeps the journal and the answer, and marks the sync failed", async () => {
    const { journal, queue, local, sync } = await setup()
    // The server's cursor is 9, but this mirror (as an older build would
    // have) starts its journal at 1.
    const post = cursorServer({ v: 9 })

    await journal.putAttempt(
      makeLocalState({
        attemptId: "srv-1",
        serverKnown: true,
        origin: "hydrated",
        sections: serverEnvelope(0).sections,
        currentSectionId: "sec-l",
        currentQuestionId: "q-l1",
        attemptStartedAt: iso(T0),
        attemptExpiresAt: iso(T0 + 1_200_000),
      }),
    )
    await answerOffline(local, queue)

    const outcome = await sync(post).syncNow("srv-1")

    expect(outcome.kind).toBe("terminal")
    expect(await journal.pendingCount("srv-1")).toBe(2)
    expect((await journal.getAttempt("srv-1"))?.syncError).toBe(
      "offline_sync_ack_mismatch",
    )
    expect(await queue.snapshotForAttempt("srv-1")).toHaveLength(1)
  })

  it("defence in depth: a first send that the server processed none of keeps everything", async () => {
    const { journal, queue, local, sync } = await setup()
    const post = vi.fn(
      (body: OfflineSyncBody): Promise<OfflineSyncResponse> =>
        Promise.resolve({
          attemptId: body.attemptId,
          ackedThrough: body.events.at(-1)?.eventSeq ?? 0,
          applied: 0,
          late: 0,
          rejected: 0,
          answersAcked: 0,
          finalized: null,
        }),
    )

    await local.hydrate(serverEnvelope(0))
    await answerOffline(local, queue)

    expect((await sync(post).syncNow("srv-1")).kind).toBe("terminal")
    expect(await journal.pendingCount("srv-1")).toBe(2)
    expect(await queue.snapshotForAttempt("srv-1")).toHaveLength(1)
  })

  it("defence in depth (A5): a first send the server processed only PART of (its cursor overlaps the new events) keeps everything", async () => {
    const { journal, queue, local, sync } = await setup()
    // The server's cursor is 2; this mirror's journal (as an older build
    // would have) starts at 1, so events 1-2 would be skipped yet acked.
    const post = cursorServer({ v: 2 })

    await journal.putAttempt(
      makeLocalState({
        attemptId: "srv-1",
        serverKnown: true,
        origin: "hydrated",
        sections: serverEnvelope(0).sections,
        currentSectionId: "sec-l",
        currentQuestionId: "q-l1",
        attemptStartedAt: iso(T0),
        attemptExpiresAt: iso(T0 + 1_200_000),
      }),
    )
    await answerOffline(local, queue)
    await answerOffline(local, queue)

    const outcome = await sync(post).syncNow("srv-1")

    expect(outcome).toEqual({
      kind: "terminal",
      type: "offline_sync_ack_mismatch",
    })
    expect(await journal.pendingCount("srv-1")).toBe(4)
    expect(await queue.snapshotForAttempt("srv-1")).toHaveLength(1)
  })

  it("a retry of a batch the server already applied (lost response) is still acknowledged", async () => {
    const { journal, local, queue, sync } = await setup()
    const cursor = { v: 0 }
    const server = cursorServer(cursor)
    // The first request lands, but its response is lost.
    const post = vi
      .fn<(b: OfflineSyncBody) => Promise<OfflineSyncResponse>>()
      .mockImplementationOnce(async (body) => {
        await server(body)

        throw new TypeError("Failed to fetch")
      })
      .mockImplementation(server)

    await local.hydrate(serverEnvelope(0))
    await answerOffline(local, queue)

    expect((await sync(post).syncNow("srv-1")).kind).toBe("synced")
    expect(await journal.pendingCount("srv-1")).toBe(0)
    expect((await journal.getAttempt("srv-1"))?.syncError).toBeNull()
  })
})

describe("an online answer whose flush never landed, then the network drops", () => {
  it("finishing the section offline journals the answer BEFORE finish_section, and the sync applies it", async () => {
    const { journal, queue, local, sync } = await setup()
    const online = { v: true }
    const cursor = { v: 0 }
    const post = cursorServer(cursor)
    const journalSync = sync(post)
    const remote = new RemoteAttemptGateway({
      startAttempt: () => Promise.reject(new TypeError("Failed to fetch")),
      getRunnerEnvelope: () => Promise.resolve(serverEnvelope(0)),
      enterSection: () => Promise.reject(new TypeError("Failed to fetch")),
      setPosition: () => Promise.reject(new TypeError("Failed to fetch")),
      claimPlay: () => Promise.reject(new TypeError("Failed to fetch")),
      finishSection: () => Promise.reject(new TypeError("Failed to fetch")),
      submitAttempt: () => Promise.reject(new TypeError("Failed to fetch")),
    })
    const hybrid = new HybridAttemptGateway({
      remote,
      local,
      journal,
      sync: journalSync,
      isOnline: () => online.v,
    })

    await hybrid.loadEnvelope("srv-1")

    // Tapped online: queued and only mirrored (the FlushController owns the
    // send) -- and that send never lands.
    const queued = await queue.recordAnswer(
      {
        attemptId: "srv-1",
        sectionId: "sec-l",
        questionId: "q-l1",
        selectedChoiceIds: ["c-l1b"],
        timeSpentMs: null,
      },
      new Date(T0),
    )

    await hybrid.noteAnswer("srv-1", queued)
    expect(await journal.eventsAfter("srv-1", 0)).toEqual([])

    online.v = false
    await hybrid.finishSection(
      "srv-1",
      "sec-l",
      await buildSectionFinishRemainder(queue, "srv-1", "sec-l"),
    )

    const journaled = await journal.eventsAfter("srv-1", 0)

    expect(journaled.map((e) => e.type)).toEqual(["answer", "finish_section"])
    expect(journaled[0]?.payload).toEqual({
      sectionId: "sec-l",
      questionId: "q-l1",
      clientInstanceId: queue.clientInstanceId(),
      seq: queued.seq,
      selectedChoiceIds: ["c-l1b"],
    })

    online.v = true
    expect((await journalSync.syncNow("srv-1")).kind).toBe("synced")
    await expect(post.mock.results[0]?.value).resolves.toMatchObject({
      applied: 2,
      answersAcked: 1,
    })
    expect(await queue.snapshotForAttempt("srv-1")).toEqual([])
  })
})
