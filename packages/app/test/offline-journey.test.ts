import "fake-indexeddb/auto"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { AnswerQueue } from "../src/lib/answerQueue.js"
import type { OfflineBundle } from "../src/lib/api-types.js"
import { HybridAttemptGateway } from "../src/lib/attempt/hybrid-gateway.js"
import { JournalStore } from "../src/lib/attempt/journal-store.js"
import {
  createJournalSync,
  type OfflineSyncBody,
  type OfflineSyncResponse,
} from "../src/lib/attempt/journal-sync.js"
import { LocalAttemptGateway } from "../src/lib/attempt/local-gateway.js"
import { RemoteAttemptGateway } from "../src/lib/attempt/remote-gateway.js"
import { createSyncStatusStore } from "../src/lib/attempt/sync-status.js"
import { buildSectionFinishRemainder } from "../src/lib/lifecycleFlush.js"
import { makeBundle } from "./helpers/bundle-fixture.js"

// ---------------------------------------------------------------------------
// A verbatim copy of the server's request schema, from
// packages/server/src/attempts/offline-sync-request.schema.ts
// (OfflineJournalEventSchema / OfflineSyncRequestSchema). Keep in step with it:
// it is what refuses a malformed journal with a 400.
const Uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu,
    "invalid_uuid",
  )
const base = {
  eventSeq: z.number().int().positive(),
  clientAt: z.iso.datetime(),
}
const OfflineJournalEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...base,
    type: z.literal("start"),
    payload: z.strictObject({ slug: z.string().min(1), testVersionId: Uuid }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("enter_section"),
    payload: z.strictObject({ sectionId: Uuid }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("play"),
    payload: z.strictObject({ stimulusId: Uuid }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("position"),
    payload: z.strictObject({ sectionId: Uuid, questionId: Uuid }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("answer"),
    payload: z.strictObject({
      sectionId: Uuid,
      questionId: Uuid,
      clientInstanceId: z.string().min(1),
      seq: z.number().int().nonnegative(),
      selectedChoiceIds: z
        .array(Uuid)
        .refine(
          (ids) =>
            new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
          "duplicate_choice",
        ),
      timeSpentMs: z.number().int().nonnegative().max(2_147_483_647).optional(),
    }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("finish_section"),
    payload: z.strictObject({ sectionId: Uuid }),
  }),
])
const OfflineSyncRequestSchema = z.strictObject({
  attemptId: Uuid,
  clientSentAt: z.iso.datetime(),
  events: z.array(OfflineJournalEventSchema).min(1).max(500),
})
// ---------------------------------------------------------------------------

/** The fixture bundle with every id a real uuid, as the server issues them. */
function uuidBundle(): { bundle: OfflineBundle; id: (name: string) => string } {
  const names = [
    "ver-1",
    "sec-l",
    "sec-r",
    "g-l",
    "g-r",
    "st-l",
    "st-r",
    "q-l1",
    "q-l2",
    "q-r1",
    "c-l1a",
    "c-l1b",
    "c-l2a",
    "c-l2b",
    "c-r1a",
    "c-r1b",
  ]
  const ids = new Map(names.map((name) => [name, crypto.randomUUID()]))
  let json = JSON.stringify(makeBundle())

  for (const [name, uuid] of ids) {
    json = json.replaceAll(`"${name}"`, `"${uuid}"`)
  }

  return {
    bundle: JSON.parse(json) as OfflineBundle,
    id: (name) => ids.get(name) ?? name,
  }
}

const offlineFetch = (): Promise<never> =>
  Promise.reject(new TypeError("Failed to fetch"))

describe("an offline attempt from start to finished section, as the server will read it", () => {
  it("journals a strictly valid, contiguous, time-ordered journal and sends it with clientSentAt >= every clientAt", async () => {
    const { bundle, id } = uuidBundle()
    const journal = await JournalStore.open("pp-offline-journey")
    const queue = await AnswerQueue.open("pp-offline-journey-q")
    const tick = { ms: Date.parse("2026-11-22T11:00:00.000Z") }
    // Every read of the clock moves it on a little, like a real phone.
    const clock = {
      nowMs: () => {
        tick.ms += 250

        return tick.ms
      },
    }
    const local = new LocalAttemptGateway({
      journal,
      clock,
      bundles: {
        list: () => Promise.resolve([]),
        getBundle: () => Promise.resolve(bundle),
        getMediaBlob: () => Promise.resolve(new Blob([new Uint8Array([1])])),
      },
      newId: () => crypto.randomUUID(),
      objectUrl: () => "blob:x",
      requestSync: () => undefined,
      ownerSub: () => "sub-1",
    })
    const post = vi.fn(
      (body: OfflineSyncBody): Promise<OfflineSyncResponse> =>
        Promise.resolve({
          attemptId: body.attemptId,
          ackedThrough: body.events.at(-1)?.eventSeq ?? 0,
          applied: body.events.length,
          late: 0,
          rejected: 0,
          answersAcked: 1,
          finalized: null,
        }),
    )
    const online = { v: false }
    const sync = createJournalSync({
      journal,
      post,
      openQueue: () => Promise.resolve(queue),
      scheduler: () => Promise.resolve(),
      clockNow: () => clock.nowMs(),
      isOnline: () => online.v,
      currentSub: () => "sub-1",
      onSynced: () => undefined,
      status: createSyncStatusStore(),
    })
    const hybrid = new HybridAttemptGateway({
      remote: new RemoteAttemptGateway({
        startAttempt: offlineFetch,
        getRunnerEnvelope: offlineFetch,
        enterSection: offlineFetch,
        setPosition: offlineFetch,
        claimPlay: offlineFetch,
        finishSection: offlineFetch,
        submitAttempt: offlineFetch,
      }),
      local,
      journal,
      sync,
      isOnline: () => online.v,
    })

    const attempt = await hybrid.start(bundle.slug)

    await hybrid.enterSection(attempt.id, id("sec-l"))
    await hybrid.claimPlay(attempt.id, id("st-l"))

    const queued = await queue.recordAnswer(
      {
        attemptId: attempt.id,
        sectionId: id("sec-l"),
        questionId: id("q-l1"),
        selectedChoiceIds: [id("c-l1b")],
        timeSpentMs: null,
      },
      new Date(tick.ms),
    )

    await hybrid.noteAnswer(attempt.id, queued)
    await hybrid.setPosition(attempt.id, id("sec-l"), id("q-l2"))
    await hybrid.finishSection(
      attempt.id,
      id("sec-l"),
      await buildSectionFinishRemainder(queue, attempt.id, id("sec-l")),
    )

    const events = await journal.eventsAfter(attempt.id, 0)

    expect(events.map((e) => e.type)).toEqual([
      "start",
      "enter_section",
      "play",
      "answer",
      "position",
      "finish_section",
    ])
    expect(events.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4, 5, 6])

    online.v = true
    expect((await sync.syncNow(attempt.id)).kind).toBe("synced")

    const body = post.mock.calls.map(([sent]) => sent).at(0)
    const parsed = OfflineSyncRequestSchema.safeParse(body)

    expect(parsed.error?.issues ?? []).toEqual([])
    expect(body?.events).toHaveLength(6)
    expect(body?.events[0]?.payload).toEqual({
      slug: bundle.slug,
      testVersionId: id("ver-1"),
    })

    const stamps = (body?.events ?? []).map((e) => Date.parse(e.clientAt))
    const sentAt = Date.parse(body?.clientSentAt ?? "")

    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps)
    expect(Math.max(...stamps)).toBeLessThanOrEqual(sentAt)
    expect(await journal.pendingCount(attempt.id)).toBe(0)
  })
})
