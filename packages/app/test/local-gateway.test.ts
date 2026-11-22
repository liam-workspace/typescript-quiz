import "fake-indexeddb/auto"
import { describe, expect, it, vi } from "vitest"
import type { RunnerEnvelope } from "../src/lib/api-types.js"
import { OfflineError } from "../src/lib/attempt/attempt-gateway.js"
import { JournalStore } from "../src/lib/attempt/journal-store.js"
import {
  LocalAttemptGateway,
  type LocalGatewayDeps,
} from "../src/lib/attempt/local-gateway.js"
import { makeBundle } from "./helpers/bundle-fixture.js"
import { makeLocalState } from "./helpers/local-state-fixture.js"

let n = 0
const T0 = Date.parse("2026-11-22T11:00:00.000Z")
const iso = (ms: number): string => new Date(ms).toISOString()

async function setup(
  opts: { saved?: boolean; media?: boolean; journal?: JournalStore } = {},
) {
  n += 1
  const journal = opts.journal ?? (await JournalStore.open(`pp-local-gw-${n}`))
  const now = { v: T0 }
  const bundle = makeBundle()
  const requestSync = vi.fn()
  const owner = { sub: "sub-1" as string | null }
  const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6])], {
    type: "audio/mpeg",
  })
  const deps: LocalGatewayDeps = {
    journal,
    clock: { nowMs: () => now.v },
    bundles: {
      list: () =>
        Promise.resolve(
          opts.saved === false
            ? []
            : [
                {
                  slug: bundle.slug,
                  testVersionId: bundle.testVersionId,
                  version: 1,
                  title: bundle.title,
                  level: bundle.level,
                  totalBytes: 6,
                  savedAt: "x",
                },
              ],
        ),
      getBundle: (slug) =>
        Promise.resolve(
          opts.saved !== false && slug === bundle.slug ? bundle : null,
        ),
      getMediaBlob: (key) =>
        Promise.resolve(opts.media !== false && key === "l1.mp3" ? blob : null),
    },
    newId: () => "att-1",
    objectUrl: () => "blob:fake-audio",
    requestSync,
    ownerSub: () => owner.sub,
  }
  const local = new LocalAttemptGateway(deps)

  return { journal, now, local, requestSync, owner, deps }
}

const types = async (journal: JournalStore, id = "att-1"): Promise<string[]> =>
  (await journal.eventsAfter(id, 0)).map((e) => e.type)

/** The server's view of an attempt in its listening section, 30 s ahead of this phone. */
function serverEnvelope(id = "srv-1"): RunnerEnvelope {
  return {
    id,
    status: "in_progress",
    attemptNumber: 2,
    testTitle: "Practice Test 3",
    expiresAt: "2026-11-22T11:20:30.000Z",
    serverTime: "2026-11-22T11:00:30.000Z",
    questionCount: 3,
    answeredCount: 1,
    unansweredOrdinals: [2, 3],
    offlineJournalCursor: 0,
    currentSectionId: "sec-l",
    currentQuestionId: "q-l1",
    sections: makeLocalState().sections.map((s) =>
      s.id === "sec-l"
        ? {
            ...s,
            status: "open" as const,
            expiresAt: "2026-11-22T11:10:30.000Z",
            groups: s.groups.map((g) =>
              g.stimulus && g.stimulus.maxPlays !== null
                ? { ...g, stimulus: { ...g.stimulus, playsUsed: 0 } }
                : g,
            ),
          }
        : s,
    ),
    responses: [
      {
        questionId: "q-l1",
        selectedChoiceIds: ["c-l1a"],
        clientInstanceId: "dev",
        seq: 3,
      },
    ],
  }
}

describe("LocalAttemptGateway — start", () => {
  it("creates a local attempt, journals a start event and resumes on a second call", async () => {
    const { local, journal, requestSync } = await setup()
    const started = await local.start("practice-3")

    expect(started).toMatchObject({
      id: "att-1",
      status: "in_progress",
      resumed: false,
      expiresAt: null,
    })
    expect(await journal.eventsAfter("att-1", 0)).toEqual([
      expect.objectContaining({
        type: "start",
        eventSeq: 1,
        payload: { slug: "practice-3", testVersionId: "ver-1" },
      }),
    ])
    expect((await journal.getAttempt("att-1"))?.serverKnown).toBe(false)
    expect(requestSync).toHaveBeenCalled()
    expect(await local.start("practice-3")).toMatchObject({
      id: "att-1",
      resumed: true,
    })
    expect(await types(journal)).toEqual(["start"])
  })

  it("records the owning student and never resumes another student's attempt on a shared device", async () => {
    const { local, journal, deps } = await setup()

    await local.start("practice-3")

    expect((await journal.getAttempt("att-1"))?.ownerSub).toBe("sub-1")

    const sibling = new LocalAttemptGateway({
      ...deps,
      newId: () => "att-sibling",
      ownerSub: () => "sub-2",
    })

    expect(await sibling.start("practice-3")).toMatchObject({
      id: "att-sibling",
      resumed: false,
    })
    // ...and the sibling cannot drive the first student's attempt either.
    await expect(sibling.setPosition("att-1", "sec-l", "q-l1")).rejects.toEqual(
      new OfflineError("not_hydrated"),
    )
  })

  it("with nobody signed in, starts nothing and mirrors nothing (an unowned attempt would be anybody's)", async () => {
    const { local, journal, owner } = await setup()

    owner.sub = null

    await expect(local.start("practice-3")).rejects.toEqual(
      new OfflineError("no_owner"),
    )
    await expect(local.hydrate(serverEnvelope())).rejects.toEqual(
      new OfflineError("no_owner"),
    )
    expect(await journal.listAttempts()).toEqual([])
  })

  it("a row with no recorded owner is nobody's: never resumed, driven or reported", async () => {
    const { local, journal } = await setup()

    await journal.putAttempt(makeLocalState({ ownerSub: null }))

    await expect(local.setPosition("att-1", "sec-l", "q-l1")).rejects.toEqual(
      new OfflineError("not_hydrated"),
    )
    expect(await local.isLocalOnly("att-1")).toBe(false)
    expect(await local.getMine("att-1")).toBeNull()
  })

  it("does not resume an attempt whose journal the server refused", async () => {
    const { local, journal } = await setup()

    await local.start("practice-3")
    await journal.update("att-1", (s) => ({
      ...s,
      syncError: "offline_journal_invalid",
    }))

    await expect(local.start("practice-3")).rejects.toEqual(
      new OfflineError("sync_failed"),
    )
  })

  it("does not resume an attempt whose clock ran out: it is finalized and reported as expired", async () => {
    const { local, journal, now } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")
    now.v = T0 + 1_200_000

    await expect(local.start("practice-3")).rejects.toMatchObject({
      problem: { type: "attempt_expired" },
    })
    expect((await journal.getAttempt("att-1"))?.finalized?.status).toBe(
      "expired",
    )
  })

  it("refuses to start offline over an in-progress ONLINE attempt this phone never loaded (the server would refuse it as a conflict)", async () => {
    const { local, journal } = await setup()

    await expect(
      local.start("practice-3", { inProgressAttemptId: "srv-9" }),
    ).rejects.toEqual(new OfflineError("not_hydrated"))
    expect(await journal.listAttempts()).toEqual([])
  })

  it("continues an in-progress online attempt this phone holds (Continue from the library)", async () => {
    const { local } = await setup()

    await local.hydrate(serverEnvelope("srv-9"))

    expect(
      await local.start("practice-3", { inProgressAttemptId: "srv-9" }),
    ).toMatchObject({ id: "srv-9", resumed: true })
  })

  it("without a saved test throws OfflineError(not_saved)", async () => {
    const { local } = await setup({ saved: false })

    await expect(local.start("practice-3")).rejects.toMatchObject({
      reason: "not_saved",
    })
  })

  it("a failed journal write leaves no attempt behind (journal-first: state and event are atomic)", async () => {
    const { local, journal } = await setup()

    vi.spyOn(journal, "createWithEvent").mockRejectedValueOnce(
      new DOMException("quota", "QuotaExceededError"),
    )

    await expect(local.start("practice-3")).rejects.toThrow()
    expect(await journal.listAttempts()).toEqual([])
  })
})

describe("LocalAttemptGateway — sections", () => {
  it("enterSection starts the attempt clock on first entry, journals it, and is idempotent while open", async () => {
    const { local, journal } = await setup()

    await local.start("practice-3")

    const entry = await local.enterSection("att-1", "sec-l")

    expect(Date.parse(entry.expiresAt) - T0).toBe(600_000)
    expect(Date.parse(entry.attemptExpiresAt ?? "") - T0).toBe(1_200_000)
    expect(entry.playback).toEqual({
      maxPlays: 1,
      allowPause: false,
      allowSeek: false,
    })

    const again = await local.enterSection("att-1", "sec-l")

    expect(again.expiresAt).toBe(entry.expiresAt)
    expect(again.attemptStartedAt).toBeUndefined()
    expect(await types(journal)).toEqual(["start", "enter_section"])
  })

  it("refuses a second section while the first is still ticking", async () => {
    const { local } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")

    await expect(local.enterSection("att-1", "sec-r")).rejects.toMatchObject({
      problem: { type: "section_still_open", status: 409 },
    })
  })

  it("never enters sections out of order (the server refuses the whole journal for it)", async () => {
    const { local, journal } = await setup()

    await local.start("practice-3")

    await expect(local.enterSection("att-1", "sec-r")).rejects.toMatchObject({
      problem: { type: "section_out_of_order", status: 409 },
    })
    expect(await types(journal)).toEqual(["start"])
  })

  it("a section whose clock ran out is journaled as finished before the next one is entered", async () => {
    const { local, journal, now } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")
    now.v = T0 + 600_000

    await local.enterSection("att-1", "sec-r")

    const events = await journal.eventsAfter("att-1", 0)

    expect(events.map((e) => [e.type, e.payload])).toEqual([
      ["start", { slug: "practice-3", testVersionId: "ver-1" }],
      ["enter_section", { sectionId: "sec-l" }],
      ["finish_section", { sectionId: "sec-l" }],
      ["enter_section", { sectionId: "sec-r" }],
    ])
    expect(
      (await journal.getAttempt("att-1"))?.sections.map((s) => s.status),
    ).toEqual(["closed", "open"])
  })

  it("re-entering a closed section is section_expired", async () => {
    const { local } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")
    await local.finishSection("att-1", "sec-l", {
      clientInstanceId: "i",
      responses: [],
    })

    await expect(local.enterSection("att-1", "sec-l")).rejects.toMatchObject({
      problem: { type: "section_expired", status: 410 },
    })
  })

  it("finishSection closes the section, names the next one, and the last returns null", async () => {
    const { local, journal } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")

    const first = await local.finishSection("att-1", "sec-l", {
      clientInstanceId: "i",
      responses: [],
    })

    expect(first).toEqual({
      sectionId: "sec-l",
      status: "finished",
      nextSectionId: "sec-r",
      finalFlush: [],
    })

    await local.enterSection("att-1", "sec-r")

    const last = await local.finishSection("att-1", "sec-r", {
      clientInstanceId: "i",
      responses: [],
    })

    expect(last.nextSectionId).toBeNull()
    expect(await types(journal)).toEqual([
      "start",
      "enter_section",
      "finish_section",
      "enter_section",
      "finish_section",
    ])
  })
})

describe("LocalAttemptGateway — position and plays", () => {
  it("forward-only: backwards is navigation_locked and not journaled; forwards is journaled", async () => {
    const { local, journal } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")
    await local.setPosition("att-1", "sec-l", "q-l2")

    await expect(
      local.setPosition("att-1", "sec-l", "q-l1"),
    ).rejects.toMatchObject({
      problem: { type: "navigation_locked", status: 409 },
    })
    expect(await types(journal)).toEqual(["start", "enter_section", "position"])
  })

  it("position after the section clock ran out is section_expired (deadline from the local clock)", async () => {
    const { local, now } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")
    now.v = T0 + 599_999
    await local.setPosition("att-1", "sec-l", "q-l2")
    now.v = T0 + 600_000

    await expect(
      local.setPosition("att-1", "sec-l", "q-l2"),
    ).rejects.toMatchObject({
      problem: { type: "section_expired", status: 410 },
    })
  })

  it("claimPlay spends the single play from the saved blob, then refuses (the client counts plays against maxPlays)", async () => {
    const { local, journal } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")

    const grant = await local.claimPlay("att-1", "st-l")

    expect(grant).toMatchObject({
      stimulusId: "st-l",
      playsUsed: 1,
      playsRemaining: 0,
      mediaUrl: "blob:fake-audio",
    })
    await expect(local.claimPlay("att-1", "st-l")).rejects.toMatchObject({
      problem: { type: "no_plays_remaining", status: 409 },
    })
    expect(await types(journal)).toEqual(["start", "enter_section", "play"])
  })

  it("two tabs racing for the last play journal exactly one play", async () => {
    const first = await setup()
    const second = await setup({ journal: first.journal })

    await first.local.start("practice-3")
    await first.local.enterSection("att-1", "sec-l")

    const results = await Promise.allSettled([
      first.local.claimPlay("att-1", "st-l"),
      second.local.claimPlay("att-1", "st-l"),
    ])

    expect(results.map((r) => r.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ])
    expect(await types(first.journal)).toEqual([
      "start",
      "enter_section",
      "play",
    ])
    expect((await first.journal.getAttempt("att-1"))?.playsUsed).toEqual({
      "st-l": 1,
    })
  })

  it("claimPlay without the audio on this phone is OfflineError(media_missing) and does NOT consume the play", async () => {
    const { local, journal } = await setup({ media: false })

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")

    await expect(local.claimPlay("att-1", "st-l")).rejects.toEqual(
      new OfflineError("media_missing"),
    )
    expect(
      (await journal.getAttempt("att-1"))?.playsUsed["st-l"],
    ).toBeUndefined()
    expect(await types(journal)).toEqual(["start", "enter_section"])
  })

  it("past the whole-attempt deadline every call is attempt_expired with a result URL, and it stays finalized", async () => {
    const { local, now, journal } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")
    await local.finishSection("att-1", "sec-l", {
      clientInstanceId: "i",
      responses: [],
    })
    await local.enterSection("att-1", "sec-r")
    now.v = T0 + 1_200_000

    await expect(
      local.setPosition("att-1", "sec-r", "q-r1"),
    ).rejects.toMatchObject({
      problem: {
        type: "attempt_expired",
        status: 410,
        attempt: {
          id: "att-1",
          status: "expired",
          resultUrl: "/attempts/att-1/result",
        },
      },
    })
    expect((await journal.getAttempt("att-1"))?.finalized?.status).toBe(
      "expired",
    )

    // Even a clock read that looks earlier cannot reopen it.
    now.v = T0
    await expect(local.loadEnvelope("att-1")).rejects.toMatchObject({
      problem: { type: "attempt_expired" },
    })
  })

  it("submit is remote-only", async () => {
    const { local } = await setup()

    await expect(
      local.submit("att-1", { clientInstanceId: "i", responses: [] }),
    ).rejects.toMatchObject({ reason: "offline" })
  })
})

describe("LocalAttemptGateway — answers, envelope, hydration", () => {
  const answer = {
    attemptId: "att-1",
    sectionId: "sec-l",
    questionId: "q-l1",
    clientInstanceId: "dev",
    seq: 7,
    selectedChoiceIds: ["c-l1b"],
    answeredAt: "2026-11-22T11:00:05.000Z",
    timeSpentMs: null,
    terminalRejection: false,
  }

  it("noteAnswer journals the answer with its queue seq, in the server's exact payload shape", async () => {
    const { local, journal } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")
    await local.noteAnswer("att-1", answer)

    const event = (await journal.eventsAfter("att-1", 0)).at(2)

    expect(event).toMatchObject({ type: "answer" })
    expect(event?.payload).toEqual({
      sectionId: "sec-l",
      questionId: "q-l1",
      clientInstanceId: "dev",
      seq: 7,
      selectedChoiceIds: ["c-l1b"],
    })
    expect((await local.loadEnvelope("att-1")).responses).toEqual([
      {
        questionId: "q-l1",
        selectedChoiceIds: ["c-l1b"],
        clientInstanceId: "dev",
        seq: 7,
        answeredAt: "2026-11-22T11:00:05.000Z",
      },
    ])
  })

  it("loadEnvelope reports local progress and plays used", async () => {
    const { local } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")
    await local.claimPlay("att-1", "st-l")

    const envelope = await local.loadEnvelope("att-1")
    const stimulus = envelope.sections[0]?.groups[0]?.stimulus

    expect(envelope).toMatchObject({
      id: "att-1",
      currentSectionId: "sec-l",
      currentQuestionId: "q-l1",
      questionCount: 3,
    })
    expect(envelope.sections[0]).toMatchObject({ status: "open" })
    expect(stimulus && "playsUsed" in stimulus ? stimulus.playsUsed : -1).toBe(
      1,
    )
  })

  it("hydrate converts server times to the local timeline and never overwrites local progress", async () => {
    const { local, journal, now } = await setup()
    const envelope = serverEnvelope()

    await local.hydrate(envelope)

    const state = await journal.getAttempt("srv-1")

    // 11:20:30 server == 11:20:00 local
    expect(state?.attemptExpiresAt).toBe("2026-11-22T11:20:00.000Z")
    expect(state?.sections[0]?.expiresAt).toBe("2026-11-22T11:10:00.000Z")
    expect(state).toMatchObject({
      serverKnown: true,
      origin: "hydrated",
      ownerSub: "sub-1",
    })
    expect(state?.responses).toEqual(envelope.responses)

    // Local work not yet acknowledged must win over a fresher-looking server snapshot.
    await local.setPosition("srv-1", "sec-l", "q-l2")
    now.v = T0 + 20_000
    await local.hydrate(envelope)

    expect((await journal.getAttempt("srv-1"))?.currentQuestionId).toBe("q-l2")
  })

  it("a hydrated attempt continues offline: deadlines from the local clock, plays from the saved copy", async () => {
    const { local, journal, now } = await setup()

    await local.hydrate(serverEnvelope())
    await local.setPosition("srv-1", "sec-l", "q-l2")
    expect((await local.claimPlay("srv-1", "st-l")).mediaUrl).toBe(
      "blob:fake-audio",
    )
    now.v = Date.parse("2026-11-22T11:10:00.000Z")

    await expect(
      local.setPosition("srv-1", "sec-l", "q-l2"),
    ).rejects.toMatchObject({ problem: { type: "section_expired" } })
    expect(await types(journal, "srv-1")).toEqual(["position", "play"])
  })

  it("mirrors a remote play so a later offline claim cannot replay a capped recording", async () => {
    const { local } = await setup()

    await local.hydrate(serverEnvelope())
    await local.mirrorPlay("srv-1", "st-l", 1)

    await expect(local.claimPlay("srv-1", "st-l")).rejects.toMatchObject({
      problem: { type: "no_plays_remaining" },
    })
  })

  it("mirrors remote moves and entries onto the local timeline without journaling them", async () => {
    const { local, journal } = await setup()

    await local.hydrate(serverEnvelope())
    await local.mirrorPosition("srv-1", "sec-l", "q-l2")
    await local.mirrorFinish("srv-1", "sec-l")
    await local.mirrorEnter("srv-1", {
      sectionId: "sec-r",
      title: "Reading",
      type: "reading",
      questionCount: 1,
      enteredAt: "2026-11-22T11:00:30.000Z",
      expiresAt: "2026-11-22T11:10:30.000Z",
      serverTime: "2026-11-22T11:00:30.000Z",
      navigation: "free",
      allowAnswerChange: true,
      playback: null,
      instructions: [],
    })

    const state = await journal.getAttempt("srv-1")

    expect(state?.sections.map((s) => [s.status, s.expiresAt])).toEqual([
      ["closed", "2026-11-22T11:10:00.000Z"],
      ["open", iso(T0 + 600_000)],
    ])
    expect(state).toMatchObject({
      currentSectionId: "sec-r",
      currentQuestionId: "q-r1",
    })
    expect(await types(journal, "srv-1")).toEqual([])
  })

  it("isLocalOnly is true only for this student's attempt the server does not know", async () => {
    const { local, owner } = await setup()

    await local.start("practice-3")

    expect(await local.isLocalOnly("att-1")).toBe(true)
    expect(await local.isLocalOnly("nope")).toBe(false)

    owner.sub = "sub-2"

    expect(await local.isLocalOnly("att-1")).toBe(false)
  })
})
