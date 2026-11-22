import "fake-indexeddb/auto"
import { describe, expect, it, vi, type Mock } from "vitest"
import { ApiError } from "../src/lib/api-client.js"
import type { RunnerEnvelope } from "../src/lib/api-types.js"
import {
  OfflineError,
  type AttemptGateway,
} from "../src/lib/attempt/attempt-gateway.js"
import { HybridAttemptGateway } from "../src/lib/attempt/hybrid-gateway.js"
import { JournalStore } from "../src/lib/attempt/journal-store.js"
import type { JournalSync } from "../src/lib/attempt/journal-sync.js"
import { LocalAttemptGateway } from "../src/lib/attempt/local-gateway.js"
import { makeBundle } from "./helpers/bundle-fixture.js"
import { makeLocalState } from "./helpers/local-state-fixture.js"

let n = 0
const T0 = Date.parse("2026-11-22T11:00:00.000Z")
const iso = (ms: number): string => new Date(ms).toISOString()
const offlineFetch = (): TypeError => new TypeError("Failed to fetch")

/** The server's runner envelope: listening open, nothing played yet. */
function envelopeFor(id: string): RunnerEnvelope {
  return {
    id,
    status: "in_progress",
    attemptNumber: 1,
    testTitle: "Practice Test 3",
    expiresAt: iso(T0 + 1_200_000),
    serverTime: iso(T0),
    questionCount: 3,
    answeredCount: 0,
    unansweredOrdinals: [1, 2, 3],
    offlineJournalCursor: 0,
    currentSectionId: "sec-l",
    currentQuestionId: "q-l1",
    sections: makeLocalState().sections.map((s) =>
      s.id === "sec-l"
        ? { ...s, status: "open" as const, expiresAt: iso(T0 + 600_000) }
        : s,
    ),
    responses: [],
  }
}

type RemoteFake = { [K in keyof AttemptGateway]: Mock<AttemptGateway[K]> }

function remoteFake(log: string[]): RemoteFake {
  return {
    start: vi.fn().mockResolvedValue({ id: "srv-1" }),
    loadEnvelope: vi.fn((id: string) => Promise.resolve(envelopeFor(id))),
    enterSection: vi.fn().mockResolvedValue({ sectionId: "s" }),
    setPosition: vi.fn((_id: string, _s: string, q: string) => {
      log.push(`remote:position:${q}`)

      return Promise.resolve()
    }),
    claimPlay: vi.fn().mockResolvedValue({
      stimulusId: "st-l",
      playsUsed: 1,
      playsRemaining: 0,
      mediaUrl: "/m",
      urlExpiresAt: iso(T0),
    }),
    finishSection: vi.fn().mockResolvedValue({ nextSectionId: null }),
    submit: vi.fn().mockResolvedValue({ attemptId: "att-1" }),
    noteAnswer: vi.fn().mockResolvedValue(undefined),
    flushAnswers: vi.fn().mockResolvedValue({ flushed: true }),
    isLocalOnly: vi.fn().mockResolvedValue(false),
  }
}

async function setup(
  opts: { online?: { v: boolean }; saved?: boolean; sub?: string } = {},
) {
  n += 1
  const online = opts.online ?? { v: true }
  const saved = opts.saved ?? true
  const log: string[] = []
  const journal = await JournalStore.open(`pp-hybrid-${n}`)
  const bundle = makeBundle()
  const local = new LocalAttemptGateway({
    journal,
    clock: { nowMs: () => T0 },
    bundles: {
      list: () => Promise.resolve([]),
      getBundle: (slug) =>
        Promise.resolve(saved && slug === bundle.slug ? bundle : null),
      getMediaBlob: () => Promise.resolve(null),
    },
    newId: () => "att-1",
    objectUrl: () => "blob:x",
    requestSync: () => undefined,
    ownerSub: () => opts.sub ?? "sub-1",
  })
  const remote = remoteFake(log)
  // A sync that "succeeds": the server now holds everything that was pending.
  const syncNow = vi.fn(async (id: string) => {
    const sent = await journal.eventsAfter(id, 0)

    log.push(...sent.map((e) => `sync:${e.type}`))
    await journal.update(id, (s) => ({ ...s, serverKnown: true }))
    await journal.markSynced(id, sent.at(-1)?.eventSeq ?? 0)

    return { kind: "nothing" as const }
  })
  const sync: JournalSync = {
    syncNow,
    syncAll: vi.fn().mockResolvedValue(undefined),
    request: vi.fn(),
  }
  const hybrid = new HybridAttemptGateway({
    remote,
    local,
    journal,
    sync,
    isOnline: () => online.v,
  })

  return { journal, remote, local, syncNow, hybrid, online, log }
}

const types = async (journal: JournalStore, id: string): Promise<string[]> =>
  (await journal.eventsAfter(id, 0)).map((e) => e.type)

const openReading = makeLocalState().sections.map((s) => {
  if (s.id === "sec-r") {
    return { ...s, status: "open" as const, expiresAt: iso(T0 + 600_000) }
  }

  return { ...s, status: "closed" as const }
})

describe("HybridAttemptGateway — start", () => {
  it("passes straight through to the remote when there is no local state", async () => {
    const { hybrid, remote } = await setup()

    await hybrid.setPosition("srv-1", "s", "q")

    expect(remote.setPosition).toHaveBeenCalledWith("srv-1", "s", "q")
  })

  it("online uses the server; offline with a saved test starts locally; offline without one needs a connection", async () => {
    const online = { v: true }
    const { hybrid, remote, journal } = await setup({ online })

    await hybrid.start("practice-3")

    expect(remote.start).toHaveBeenCalledTimes(1)

    online.v = false

    expect((await hybrid.start("practice-3")).id).toBe("att-1")
    expect(remote.start).toHaveBeenCalledTimes(1)
    expect((await journal.getAttempt("att-1"))?.serverKnown).toBe(false)

    const none = await setup({ online: { v: false }, saved: false })

    await expect(none.hybrid.start("practice-3")).rejects.toMatchObject({
      reason: "not_saved",
    })
  })

  it("falls back to a local start when the network call fails outright", async () => {
    const { hybrid, remote } = await setup()

    remote.start.mockRejectedValue(offlineFetch())

    expect((await hybrid.start("practice-3")).id).toBe("att-1")
  })

  it("a server refusal on start is NOT swallowed into an offline start", async () => {
    const { hybrid, remote, journal } = await setup()

    remote.start.mockRejectedValue(
      new ApiError({ type: "test_not_found", title: "x", status: 404 }),
    )

    await expect(hybrid.start("practice-3")).rejects.toMatchObject({
      problem: { type: "test_not_found" },
    })
    expect(await journal.listAttempts()).toEqual([])
  })

  it("offline, an in-progress online attempt this phone never loaded blocks a new offline start", async () => {
    const { hybrid, journal } = await setup({ online: { v: false } })

    await expect(
      hybrid.start("practice-3", { inProgressAttemptId: "srv-untimed" }),
    ).rejects.toEqual(new OfflineError("not_hydrated"))
    expect(await journal.listAttempts()).toEqual([])
  })
})

describe("HybridAttemptGateway — routing", () => {
  it("an attempt the server does not know yet is synced first when online, then goes remote", async () => {
    const { hybrid, remote, syncNow, journal } = await setup()

    await journal.putAttempt(
      makeLocalState({ attemptId: "att-9", serverKnown: false }),
    )

    await hybrid.setPosition("att-9", "sec-l", "q-l1")

    expect(syncNow).toHaveBeenCalledWith("att-9")
    expect(remote.setPosition).toHaveBeenCalledWith("att-9", "sec-l", "q-l1")
  })

  it("offline, a server-known attempt continues locally and journals the move", async () => {
    const { hybrid, remote, journal } = await setup({ online: { v: false } })

    await journal.putAttempt(
      makeLocalState({
        attemptId: "att-2",
        serverKnown: true,
        currentSectionId: "sec-r",
        currentQuestionId: "q-r1",
        sections: openReading,
      }),
    )
    await hybrid.setPosition("att-2", "sec-r", "q-r1")

    expect(remote.setPosition).not.toHaveBeenCalled()
    expect(await types(journal, "att-2")).toEqual(["position"])
  })

  it("another student's local state on this phone is never used to answer for the signed-in student", async () => {
    const { hybrid, remote, journal } = await setup({
      online: { v: false },
      sub: "sub-2",
    })

    await journal.putAttempt(
      makeLocalState({ attemptId: "att-a", serverKnown: false }),
    )

    await hybrid.loadEnvelope("att-a")

    expect(remote.loadEnvelope).toHaveBeenCalledWith("att-a")
    // The other student's offline work is neither shown nor overwritten.
    expect(await journal.getAttempt("att-a")).toMatchObject({
      ownerSub: "sub-1",
      serverKnown: false,
    })
    expect(await hybrid.isLocalOnly("att-a")).toBe(false)
  })

  it("hydrates an online attempt and continues it locally when the network drops mid-test", async () => {
    const online = { v: true }
    const { hybrid, remote, journal } = await setup({ online })

    await hybrid.loadEnvelope("srv-1")
    await hybrid.setPosition("srv-1", "sec-l", "q-l2")
    // The one play was spent ONLINE.
    await hybrid.claimPlay("srv-1", "st-l")

    expect(await journal.getAttempt("srv-1")).toMatchObject({
      serverKnown: true,
      origin: "hydrated",
      currentQuestionId: "q-l2",
      playsUsed: { "st-l": 1 },
    })
    expect(await types(journal, "srv-1")).toEqual([])

    // The Wi-Fi dies without the browser noticing: the next call fails.
    remote.setPosition.mockRejectedValue(offlineFetch())
    remote.claimPlay.mockRejectedValue(offlineFetch())
    await hybrid.setPosition("srv-1", "sec-l", "q-l2")

    expect(await types(journal, "srv-1")).toEqual(["position"])

    // ...and the play cap is enforced locally: no second play offline.
    online.v = false
    await expect(hybrid.claimPlay("srv-1", "st-l")).rejects.toMatchObject({
      problem: { type: "no_plays_remaining" },
    })
    // Forward-only stays locked offline too.
    await expect(
      hybrid.setPosition("srv-1", "sec-l", "q-l1"),
    ).rejects.toMatchObject({ problem: { type: "navigation_locked" } })
    expect(await types(journal, "srv-1")).toEqual(["position"])
  })

  it("Wi-Fi flapping never reorders or duplicates: the journal reaches the server before the next remote call", async () => {
    const online = { v: true }
    const { hybrid, remote, syncNow, log } = await setup({ online })

    await hybrid.loadEnvelope("srv-1")
    await hybrid.setPosition("srv-1", "sec-l", "q-l1")
    online.v = false
    await hybrid.setPosition("srv-1", "sec-l", "q-l2")
    online.v = true
    await hybrid.claimPlay("srv-1", "st-l")
    await hybrid.setPosition("srv-1", "sec-l", "q-l2")

    expect(log).toEqual([
      "remote:position:q-l1",
      "sync:position",
      "remote:position:q-l2",
    ])
    expect(syncNow).toHaveBeenCalledTimes(1)
    expect(remote.claimPlay).toHaveBeenCalledTimes(1)
  })

  it("loadEnvelope falls back to the local copy on a network failure", async () => {
    const { hybrid, remote } = await setup()

    await hybrid.loadEnvelope("srv-1")
    remote.loadEnvelope.mockRejectedValue(offlineFetch())

    expect((await hybrid.loadEnvelope("srv-1")).id).toBe("srv-1")
  })
})

describe("HybridAttemptGateway — answers and hand-in", () => {
  const answer = {
    attemptId: "att-6",
    sectionId: "sec-l",
    questionId: "q-l1",
    clientInstanceId: "d",
    seq: 1,
    selectedChoiceIds: ["c-l1a"],
    answeredAt: iso(T0),
    timeSpentMs: null,
    terminalRejection: false,
  }

  it("noteAnswer journals only when the attempt is local-only, behind, or the network is down", async () => {
    const online = { v: true }
    const { hybrid, journal } = await setup({ online })

    await journal.putAttempt(
      makeLocalState({
        attemptId: "att-6",
        serverKnown: true,
        currentSectionId: "sec-l",
        currentQuestionId: "q-l1",
        sections: envelopeFor("att-6").sections,
      }),
    )
    await hybrid.noteAnswer("att-6", answer)

    expect(await types(journal, "att-6")).toEqual([])
    // ...but the local copy remembers it, for an offline reload later.
    expect((await journal.getAttempt("att-6"))?.responses).toHaveLength(1)

    online.v = false
    await hybrid.noteAnswer("att-6", answer)

    expect(await types(journal, "att-6")).toEqual(["answer"])
  })

  it("submit offline with unsynced work is an OfflineError and never reaches the server", async () => {
    const { hybrid, remote, journal } = await setup({ online: { v: false } })

    await journal.putAttempt(
      makeLocalState({ attemptId: "att-4", serverKnown: false }),
    )

    await expect(
      hybrid.submit("att-4", { clientInstanceId: "i", responses: [] }),
    ).rejects.toBeInstanceOf(OfflineError)
    expect(remote.submit).not.toHaveBeenCalled()
  })

  it("submit online syncs first, submits remotely, then drops the local copy", async () => {
    const { hybrid, remote, journal, syncNow } = await setup()

    await journal.putAttempt(
      makeLocalState({ attemptId: "att-5", serverKnown: false }),
    )
    await hybrid.submit("att-5", { clientInstanceId: "i", responses: [] })

    expect(syncNow).toHaveBeenCalledWith("att-5")
    expect(remote.submit).toHaveBeenCalled()
    expect(await journal.getAttempt("att-5")).toBeNull()
  })

  it("a journal the server refused is never handed in behind its back", async () => {
    const { hybrid, remote, journal, syncNow } = await setup()

    await journal.putAttempt(
      makeLocalState({
        attemptId: "att-8",
        serverKnown: true,
        syncError: "offline_journal_invalid",
      }),
    )

    await expect(
      hybrid.submit("att-8", { clientInstanceId: "i", responses: [] }),
    ).rejects.toBeInstanceOf(OfflineError)
    expect(remote.submit).not.toHaveBeenCalled()
    expect(syncNow).not.toHaveBeenCalled()
    expect(await journal.getAttempt("att-8")).not.toBeNull()
  })

  it("a network failure on submit is reported as OfflineError", async () => {
    const { hybrid, remote } = await setup()

    remote.submit.mockRejectedValue(offlineFetch())

    await expect(
      hybrid.submit("srv-1", { clientInstanceId: "i", responses: [] }),
    ).rejects.toBeInstanceOf(OfflineError)
  })

  it("isLocalOnly reflects serverKnown", async () => {
    const { hybrid, journal } = await setup()

    await journal.putAttempt(
      makeLocalState({ attemptId: "att-7", serverKnown: false }),
    )

    expect(await hybrid.isLocalOnly("att-7")).toBe(true)
    expect(await hybrid.isLocalOnly("unknown")).toBe(false)
  })
})
