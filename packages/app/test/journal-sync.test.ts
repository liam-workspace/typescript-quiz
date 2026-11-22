import "fake-indexeddb/auto"
import { describe, expect, it, vi } from "vitest"
import { AnswerQueue } from "../src/lib/answerQueue.js"
import { ApiError } from "../src/lib/api-client.js"
import { JournalStore } from "../src/lib/attempt/journal-store.js"
import {
  createJournalSync,
  purgeSyncedAttempts,
  type OfflineSyncBody,
  type OfflineSyncResponse,
} from "../src/lib/attempt/journal-sync.js"
import { LocalClock } from "../src/lib/attempt/local-clock.js"
import { createSyncStatusStore } from "../src/lib/attempt/sync-status.js"
import { makeLocalState } from "./helpers/local-state-fixture.js"

let n = 0
const at = "2026-11-22T11:00:00.000Z"
const AT = Date.parse(at)

const ok = (over: Partial<OfflineSyncResponse> = {}): OfflineSyncResponse => ({
  attemptId: "att-1",
  ackedThrough: 3,
  applied: 3,
  late: 0,
  rejected: 0,
  answersAcked: 1,
  finalized: null,
  ...over,
})

/** Acks exactly what was sent, the way the server does. */
const echo = (body: OfflineSyncBody): Promise<OfflineSyncResponse> =>
  Promise.resolve(
    ok({
      attemptId: body.attemptId,
      ackedThrough: body.events.at(-1)?.eventSeq ?? 0,
      applied: body.events.length,
      answersAcked: body.events.filter((e) => e.type === "answer").length,
    }),
  )

type Post = (body: OfflineSyncBody) => Promise<OfflineSyncResponse>

async function setup(
  post: Post,
  opts: { online?: { v: boolean }; clockNow?: () => number } = {},
) {
  n += 1
  const journal = await JournalStore.open(`pp-sync-${n}`)
  const queue = await AnswerQueue.open(`pp-sync-q-${n}`)
  const onSynced = vi.fn()
  const scheduler = vi.fn().mockResolvedValue(undefined)
  const status = createSyncStatusStore()
  const online = opts.online ?? { v: true }
  const sub = { v: "sub-1" as string | null }
  const sync = createJournalSync({
    journal,
    post,
    openQueue: () => Promise.resolve(queue),
    scheduler,
    clockNow: opts.clockNow ?? (() => AT),
    isOnline: () => online.v,
    currentSub: () => sub.v,
    onSynced,
    status,
  })

  await journal.putAttempt(makeLocalState())
  await journal.append("att-1", {
    type: "start",
    clientAt: at,
    payload: { slug: "p3" },
  })
  await journal.append("att-1", {
    type: "enter_section",
    clientAt: at,
    payload: { sectionId: "sec-l" },
  })

  const queued = await queue.recordAnswer(
    {
      attemptId: "att-1",
      sectionId: "sec-l",
      questionId: "q-l1",
      selectedChoiceIds: ["c-l1a"],
      timeSpentMs: null,
    },
    new Date(at),
  )

  await journal.append("att-1", {
    type: "answer",
    clientAt: at,
    payload: {
      sectionId: "sec-l",
      questionId: "q-l1",
      clientInstanceId: queued.clientInstanceId,
      seq: queued.seq,
      selectedChoiceIds: ["c-l1a"],
    },
  })

  return { journal, queue, onSynced, scheduler, status, sync, online, sub }
}

const sentBodies = (post: ReturnType<typeof vi.fn>): OfflineSyncBody[] =>
  post.mock.calls.map(([body]) => body as OfflineSyncBody)

describe("createJournalSync", () => {
  it("posts pending events, marks them synced, flips serverKnown, acks the answer queue and reports the count", async () => {
    const post = vi.fn(echo)
    const { journal, queue, onSynced, sync } = await setup(post)

    const outcome = await sync.syncNow("att-1")

    expect(outcome.kind).toBe("synced")
    expect(sentBodies(post)).toEqual([
      {
        attemptId: "att-1",
        clientSentAt: at,
        events: [
          expect.objectContaining({ eventSeq: 1, type: "start" }),
          expect.objectContaining({ eventSeq: 2, type: "enter_section" }),
          expect.objectContaining({ eventSeq: 3, type: "answer" }),
        ],
      },
    ])
    expect(await journal.pendingCount("att-1")).toBe(0)
    expect((await journal.getAttempt("att-1"))?.serverKnown).toBe(true)
    expect(await queue.snapshotForAttempt("att-1")).toEqual([])
    expect(onSynced).toHaveBeenCalledWith({
      attemptId: "att-1",
      answersAcked: 1,
    })
  })

  it("does nothing when there is nothing to send, and does not call the network when offline", async () => {
    const post = vi.fn(echo)
    const { sync } = await setup(post, { online: { v: false } })

    expect(await sync.syncNow("att-1")).toEqual({ kind: "offline" })
    expect(post).not.toHaveBeenCalled()
    expect(await sync.syncNow("no-such-attempt")).toEqual({ kind: "nothing" })
  })

  it("a wall clock stepped BACK between append and send still yields clientSentAt >= every clientAt", async () => {
    const wall = { v: AT + 60_000 }
    const mono = { v: 0 }
    const post = vi.fn(echo)
    const live: { clock: LocalClock | null } = { clock: null }
    const { journal, sync } = await setup(post, {
      clockNow: () => live.clock?.nowMs() ?? 0,
    })
    const clock = await LocalClock.create({
      wallNow: () => wall.v,
      monoNow: () => mono.v,
      loadHighWater: () => journal.loadClockHighWater(),
      saveHighWater: (ms) => journal.saveClockHighWater(ms),
    })

    live.clock = clock
    await journal.append("att-1", {
      type: "position",
      clientAt: new Date(clock.nowMs()).toISOString(),
      payload: { sectionId: "sec-l", questionId: "q-l1" },
    })
    // NTP steps the phone back two minutes before the send.
    wall.v -= 120_000
    mono.v += 10

    expect((await sync.syncNow("att-1")).kind).toBe("synced")

    const body = sentBodies(post).at(0)
    const sentAt = Date.parse(body?.clientSentAt ?? "")
    const stamps = (body?.events ?? []).map((e) => Date.parse(e.clientAt))

    expect(stamps.every((stamp) => stamp <= sentAt)).toBe(true)
    // ...and Date.now() (what the plan sketch used) would have been refused.
    expect(Math.max(...stamps)).toBeGreaterThan(wall.v)
  })

  it("clientSentAt is never below an event even when the sending clock lags it (another tab stamped it)", async () => {
    const post = vi.fn(echo)
    const { sync } = await setup(post, { clockNow: () => AT - 5_000 })

    await sync.syncNow("att-1")

    expect(sentBodies(post)[0]?.clientSentAt).toBe(at)
  })

  it("retries a 5xx with backoff, stamping clientSentAt afresh on the retry, then succeeds", async () => {
    const now = { v: AT }
    const post = vi
      .fn<Post>()
      .mockImplementationOnce(() => {
        now.v += 700

        return Promise.reject(
          new ApiError({ type: "unexpected_error", title: "x", status: 500 }),
        )
      })
      .mockImplementation(echo)
    const { sync, scheduler } = await setup(post, { clockNow: () => now.v })

    expect((await sync.syncNow("att-1")).kind).toBe("synced")
    expect(scheduler).toHaveBeenCalledWith(500)
    expect(sentBodies(post).map((b) => b.clientSentAt)).toEqual([
      at,
      new Date(AT + 700).toISOString(),
    ])
  })

  it("a single-try sync (a tap waiting on it) never backs off", async () => {
    const post = vi
      .fn<Post>()
      .mockRejectedValue(
        new ApiError({ type: "unexpected_error", title: "x", status: 503 }),
      )
    const { sync, scheduler, journal } = await setup(post)

    expect(await sync.syncNow("att-1", { singleTry: true })).toEqual({
      kind: "offline",
    })
    expect(post).toHaveBeenCalledTimes(1)
    expect(scheduler).not.toHaveBeenCalled()
    expect(await journal.pendingCount("att-1")).toBe(3)
  })

  it.each([
    ["offline_journal_invalid", 422],
    ["offline_play_cap_exceeded", 409],
    ["offline_attempt_conflict", 409],
  ])(
    "a terminal %s keeps the whole journal, records syncError and never re-sends it",
    async (type, status) => {
      const post = vi
        .fn<Post>()
        .mockRejectedValue(new ApiError({ type, title: "x", status }))
      const sync = await setup(post)

      expect(await sync.sync.syncNow("att-1")).toEqual({
        kind: "terminal",
        type,
      })
      expect(post).toHaveBeenCalledTimes(1)
      expect(await sync.journal.pendingCount("att-1")).toBe(3)
      expect(await sync.journal.getAttempt("att-1")).toMatchObject({
        syncError: type,
        serverKnown: false,
      })
      expect(await sync.queue.snapshotForAttempt("att-1")).toHaveLength(1)
      expect(sync.status.getSnapshot().failedAttemptIds).toEqual(["att-1"])

      // Neither a later sync nor sign-out cleanup throws the work away.
      await sync.sync.syncAll()
      await purgeSyncedAttempts(sync.journal)

      expect(post).toHaveBeenCalledTimes(1)
      expect(await sync.journal.pendingCount("att-1")).toBe(3)
    },
  )

  it("a 401 is not a verdict on the journal: no syncError, the next sign-in sends it", async () => {
    const post = vi
      .fn<Post>()
      .mockRejectedValue(
        new ApiError({ type: "invalid_token", title: "x", status: 401 }),
      )
    const { sync, journal } = await setup(post)

    expect((await sync.syncNow("att-1")).kind).toBe("offline")
    expect((await journal.getAttempt("att-1"))?.syncError).toBeNull()
  })

  it("treats a network failure as offline and keeps the journal", async () => {
    const post = vi
      .fn<Post>()
      .mockRejectedValue(new TypeError("Failed to fetch"))
    const online = { v: true }
    const { sync, journal, scheduler } = await setup(post, { online })

    scheduler.mockImplementation(() => {
      online.v = false

      return Promise.resolve()
    })

    expect((await sync.syncNow("att-1")).kind).toBe("offline")
    expect(post).toHaveBeenCalledTimes(1)
    expect(await journal.pendingCount("att-1")).toBe(3)
  })

  it("splits a long journal into contiguous requests of at most 500 events", async () => {
    const post = vi.fn(echo)
    const { sync, journal } = await setup(post)

    for (let i = 0; i < 600; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await journal.append("att-1", {
        type: "position",
        clientAt: at,
        payload: { sectionId: "sec-l", questionId: "q-l1" },
      })
    }

    await sync.syncNow("att-1")

    const bodies = sentBodies(post)

    expect(bodies.map((b) => b.events.length)).toEqual([500, 103])
    expect(bodies[1]?.events[0]?.eventSeq).toBe(501)
    expect(await journal.pendingCount("att-1")).toBe(0)
  })

  it("a server-side finalization (time ran out while offline) drops the fully sent local copy", async () => {
    const post = vi.fn<Post>(async (body) => ({
      ...(await echo(body)),
      finalized: { status: "expired", resultUrl: "/attempts/att-1/result" },
    }))
    const { sync, journal } = await setup(post)

    expect((await sync.syncNow("att-1")).kind).toBe("synced")
    expect(await journal.getAttempt("att-1")).toBeNull()
  })

  it("keeps ONE request in flight per attempt however often it is asked (Wi-Fi flapping)", async () => {
    let inFlight = 0
    let maxInFlight = 0
    let release: () => void = () => undefined
    const post = vi.fn<Post>(async (body) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise<void>((resolve) => {
        release = resolve
      })
      inFlight -= 1

      return echo(body)
    })
    const { sync, journal } = await setup(post)

    const first = sync.syncNow("att-1")
    const second = sync.syncNow("att-1")
    const all = sync.syncAll()

    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    // A new event lands while the first request is out.
    await journal.append("att-1", {
      type: "position",
      clientAt: at,
      payload: { sectionId: "sec-l", questionId: "q-l1" },
    })
    release()
    // The same run picks the new event up in a second, sequential request.
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    release()
    await Promise.all([first, second, all])

    expect(maxInFlight).toBe(1)
    // No event is sent twice and none out of order.
    const seqs = sentBodies(post)
      .flatMap((b) => b.events)
      .map((e) => e.eventSeq)

    expect(seqs).toEqual([1, 2, 3, 4])
    expect(await journal.pendingCount("att-1")).toBe(0)
  })

  it("never syncs (or counts) another student's attempt on a shared device", async () => {
    const post = vi.fn(echo)
    const { sync, journal, status, sub } = await setup(post)

    await journal.putAttempt(
      makeLocalState({ attemptId: "att-sibling", ownerSub: "sub-2" }),
    )
    await journal.append("att-sibling", {
      type: "start",
      clientAt: at,
      payload: { slug: "p3" },
    })

    expect(await sync.syncNow("att-sibling")).toEqual({ kind: "nothing" })

    await sync.syncAll()

    expect(sentBodies(post).map((b) => b.attemptId)).toEqual(["att-1"])
    expect(await journal.pendingCount("att-sibling")).toBe(1)
    expect(status.getSnapshot()).toMatchObject({
      pendingAttempts: 0,
      pendingEvents: 0,
    })

    // The sibling signs in: now theirs is sent, and only theirs is counted.
    sub.v = "sub-2"
    await sync.syncAll()

    expect(sentBodies(post).map((b) => b.attemptId)).toEqual([
      "att-1",
      "att-sibling",
    ])
  })

  it("never syncs or counts a row with no recorded owner, nor anything while signed out", async () => {
    const post = vi.fn(echo)
    const { sync, journal, status, sub } = await setup(post)

    await journal.putAttempt(
      makeLocalState({ attemptId: "att-unowned", ownerSub: null }),
    )
    await journal.append("att-unowned", {
      type: "start",
      clientAt: at,
      payload: { slug: "p3" },
    })
    sub.v = null
    await sync.syncAll()

    expect(post).not.toHaveBeenCalled()

    sub.v = "sub-1"
    await sync.syncAll()

    expect(sentBodies(post).map((b) => b.attemptId)).toEqual(["att-1"])
    expect(status.getSnapshot().pendingAttempts).toBe(0)
    expect(await journal.pendingCount("att-unowned")).toBe(1)
  })

  it("publishes pending counts to the status store", async () => {
    const post = vi.fn(echo)
    const { sync, status, online } = await setup(post, {
      online: { v: false },
    })

    await sync.syncAll()

    expect(status.getSnapshot()).toMatchObject({
      syncing: false,
      pendingAttempts: 1,
      pendingEvents: 3,
    })

    online.v = true
    await sync.syncAll()

    expect(status.getSnapshot()).toMatchObject({
      syncing: false,
      pendingAttempts: 0,
      pendingEvents: 0,
      failedAttemptIds: [],
    })
  })
})

describe("purgeSyncedAttempts (sign-out, spec D8)", () => {
  it("removes fully synced attempts but never unsynced work", async () => {
    const journal = await JournalStore.open("pp-purge-test")

    await journal.putAttempt(
      makeLocalState({ attemptId: "done", serverKnown: true }),
    )
    await journal.putAttempt(
      makeLocalState({ attemptId: "unsynced", serverKnown: true }),
    )
    await journal.append("unsynced", {
      type: "play",
      clientAt: at,
      payload: {},
    })
    await journal.putAttempt(
      makeLocalState({ attemptId: "never-sent", serverKnown: false }),
    )
    await journal.putAttempt(
      makeLocalState({
        attemptId: "refused",
        serverKnown: true,
        syncError: "offline_journal_invalid",
      }),
    )

    await purgeSyncedAttempts(journal)

    expect(
      (await journal.listAttempts()).map((a) => a.attemptId).sort(),
    ).toEqual(["never-sent", "refused", "unsynced"])
  })
})
