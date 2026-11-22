import "fake-indexeddb/auto"
import { describe, expect, it, vi } from "vitest"
import { LocalClock } from "../src/lib/attempt/local-clock.js"
import { JournalStore } from "../src/lib/attempt/journal-store.js"
import { makeLocalState } from "./helpers/local-state-fixture.js"

let n = 0
const freshName = (): string => {
  n += 1

  return `pp-attempts-test-${n}`
}
const at = "2026-11-22T11:00:00.000Z"

describe("JournalStore", () => {
  it("assigns contiguous eventSeq per attempt and survives a reopen", async () => {
    const name = freshName()
    const store = await JournalStore.open(name)

    await store.putAttempt(makeLocalState())

    const a = await store.append("att-1", {
      type: "start",
      clientAt: at,
      payload: { slug: "p3" },
    })
    const b = await store.append("att-1", {
      type: "enter_section",
      clientAt: at,
      payload: { sectionId: "sec-l" },
    })

    expect([a.eventSeq, b.eventSeq]).toEqual([1, 2])

    store.close()

    const reopened = await JournalStore.open(name)

    expect(
      (await reopened.eventsAfter("att-1", 0)).map((e) => e.eventSeq),
    ).toEqual([1, 2])
    expect((await reopened.getAttempt("att-1"))?.nextEventSeq).toBe(3)
  })

  it("applies the state mutation in the same transaction as the event", async () => {
    const store = await JournalStore.open(freshName())

    await store.putAttempt(makeLocalState())
    await store.append(
      "att-1",
      { type: "position", clientAt: at, payload: {} },
      (s) => ({ ...s, currentQuestionId: "q-l2", nextEventSeq: 999 }),
    )

    const state = await store.getAttempt("att-1")

    expect(state?.currentQuestionId).toBe("q-l2")
    // The store owns the counter: a mutation can never skip or reuse a seq.
    expect(state?.nextEventSeq).toBe(2)
  })

  it("writes neither event nor state when the mutation throws", async () => {
    const store = await JournalStore.open(freshName())

    await store.putAttempt(makeLocalState())
    await expect(
      store.append(
        "att-1",
        { type: "start", clientAt: at, payload: {} },
        () => {
          throw new Error("boom")
        },
      ),
    ).rejects.toThrow("boom")

    expect(await store.eventsAfter("att-1", 0)).toEqual([])
    expect((await store.getAttempt("att-1"))?.nextEventSeq).toBe(1)

    // The store is still usable and the sequence was not burned.
    const ok = await store.append("att-1", {
      type: "start",
      clientAt: at,
      payload: {},
    })

    expect(ok.eventSeq).toBe(1)
  })

  it("aborts the whole transaction when the event write fails (no state change without its event)", async () => {
    const store = await JournalStore.open(freshName())

    // A stale counter makes the event key collide with an existing event.
    await store.putAttempt(makeLocalState())
    await store.append("att-1", { type: "start", clientAt: at, payload: {} })
    await store.putAttempt(makeLocalState({ nextEventSeq: 1 }))

    await expect(
      store.append(
        "att-1",
        { type: "play", clientAt: at, payload: {} },
        (s) => ({ ...s, currentQuestionId: "q-changed" }),
      ),
    ).rejects.toMatchObject({ name: "ConstraintError" })

    const state = await store.getAttempt("att-1")

    expect(state?.currentQuestionId).toBeNull()
    expect(state?.nextEventSeq).toBe(1)
    expect((await store.eventsAfter("att-1", 0)).map((e) => e.type)).toEqual([
      "start",
    ])
  })

  it("eventsAfter returns only newer events, scoped to the attempt", async () => {
    const store = await JournalStore.open(freshName())

    await store.putAttempt(makeLocalState())
    await store.putAttempt(makeLocalState({ attemptId: "att-2" }))
    await store.append("att-1", { type: "start", clientAt: at, payload: {} })
    await store.append("att-1", { type: "play", clientAt: at, payload: {} })
    await store.append("att-2", { type: "start", clientAt: at, payload: {} })

    expect(
      (await store.eventsAfter("att-1", 1)).map((e) => e.eventSeq),
    ).toEqual([2])
    expect(await store.eventsAfter("att-2", 5)).toEqual([])
  })

  it("markSynced drops acknowledged events and advances syncedThrough", async () => {
    const store = await JournalStore.open(freshName())

    await store.putAttempt(makeLocalState())
    await store.append("att-1", { type: "start", clientAt: at, payload: {} })
    await store.append("att-1", { type: "play", clientAt: at, payload: {} })
    await store.append("att-1", { type: "answer", clientAt: at, payload: {} })

    expect(await store.pendingCount("att-1")).toBe(3)

    await store.markSynced("att-1", 2)

    expect(await store.pendingCount("att-1")).toBe(1)
    expect((await store.getAttempt("att-1"))?.syncedThrough).toBe(2)
    expect(
      (await store.eventsAfter("att-1", 0)).map((e) => e.eventSeq),
    ).toEqual([3])
  })

  it("rejects an append for an attempt that does not exist", async () => {
    const store = await JournalStore.open(freshName())

    await expect(
      store.append("nope", { type: "start", clientAt: at, payload: {} }),
    ).rejects.toThrow("no local attempt nope")
  })

  it("notifies onAppend listeners and stops after unsubscribe", async () => {
    const store = await JournalStore.open(freshName())
    const listener = vi.fn()
    const unsubscribe = store.onAppend(listener)

    await store.putAttempt(makeLocalState())
    await store.append("att-1", { type: "start", clientAt: at, payload: {} })

    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    await store.append("att-1", { type: "play", clientAt: at, payload: {} })

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("update mutates state without writing an event; deleteAttempt removes state and events", async () => {
    const store = await JournalStore.open(freshName())

    await store.putAttempt(makeLocalState())
    await store.append("att-1", { type: "start", clientAt: at, payload: {} })
    await store.update("att-1", (s) => ({
      ...s,
      syncError: "offline_journal_invalid",
    }))

    expect((await store.getAttempt("att-1"))?.syncError).toBe(
      "offline_journal_invalid",
    )
    expect(await store.pendingCount("att-1")).toBe(1)
    expect(await store.update("missing", (s) => s)).toBeNull()

    await store.deleteAttempt("att-1")

    expect(await store.getAttempt("att-1")).toBeNull()
    expect(await store.eventsAfter("att-1", 0)).toEqual([])
  })

  it("lists attempts with their owner", async () => {
    const store = await JournalStore.open(freshName())

    await store.putAttempt(makeLocalState())
    await store.putAttempt(
      makeLocalState({ attemptId: "att-2", ownerSub: "sub-2" }),
    )

    expect(
      (await store.listAttempts()).map((a) => [a.attemptId, a.ownerSub]),
    ).toEqual([
      ["att-1", "sub-1"],
      ["att-2", "sub-2"],
    ])
  })

  it("update cannot rewrite the store-owned event counter", async () => {
    const store = await JournalStore.open(freshName())

    await store.putAttempt(makeLocalState({ nextEventSeq: 4 }))
    await store.update("att-1", (s) => ({ ...s, nextEventSeq: 1 }))

    expect((await store.getAttempt("att-1"))?.nextEventSeq).toBe(4)
  })

  it("append raises the persisted clock mark to the event's clientAt (survives a crash before persist)", async () => {
    const name = freshName()
    const store = await JournalStore.open(name)
    const high = Date.parse("2026-11-22T12:00:00.000Z")

    await store.putAttempt(makeLocalState())
    await store.append("att-1", {
      type: "start",
      clientAt: new Date(high).toISOString(),
      payload: {},
    })
    store.close()

    const reopened = await JournalStore.open(name)
    const clock = await LocalClock.create({
      wallNow: () => high - 3_600_000,
      monoNow: () => 0,
      loadHighWater: () => reopened.loadClockHighWater(),
      saveHighWater: (ms) => reopened.saveClockHighWater(ms),
    })

    expect(clock.nowMs()).toBeGreaterThanOrEqual(high)
  })

  it("append never lowers the persisted mark", async () => {
    const store = await JournalStore.open(freshName())

    await store.putAttempt(makeLocalState())
    await store.saveClockHighWater(Date.parse("2030-01-01T00:00:00.000Z"))
    await store.append("att-1", { type: "start", clientAt: at, payload: {} })

    expect(await store.loadClockHighWater()).toBe(
      Date.parse("2030-01-01T00:00:00.000Z"),
    )
  })

  it("append never stamps an event below the stored mark (a second tab with a slower clock)", async () => {
    const store = await JournalStore.open(freshName())
    const tabA = "2026-11-22T11:00:05.000Z"
    // Tab B's LocalClock lags tab A's.
    const tabB = "2026-11-22T11:00:04.000Z"

    await store.putAttempt(makeLocalState())
    await store.append("att-1", { type: "start", clientAt: tabA, payload: {} })

    const second = await store.append("att-1", {
      type: "position",
      clientAt: tabB,
      payload: {},
    })
    const stamps = (await store.eventsAfter("att-1", 0)).map((e) => e.clientAt)

    expect(second.clientAt).toBe(tabA)
    expect(stamps).toEqual([tabA, tabA])
  })

  it("createWithEvent writes the attempt and its first event atomically", async () => {
    const store = await JournalStore.open(freshName())

    await store.createWithEvent(makeLocalState(), {
      type: "start",
      clientAt: at,
      payload: { slug: "practice-3" },
    })

    expect(
      (await store.eventsAfter("att-1", 0)).map((e) => e.eventSeq),
    ).toEqual([1])
    expect((await store.getAttempt("att-1"))?.nextEventSeq).toBe(2)

    // An existing attempt is never overwritten, and nothing half-lands.
    await expect(
      store.createWithEvent(makeLocalState({ title: "other" }), {
        type: "start",
        clientAt: at,
        payload: {},
      }),
    ).rejects.toThrow()
    expect((await store.getAttempt("att-1"))?.title).toBe("Practice Test 3")
    expect(await store.eventsAfter("att-1", 0)).toHaveLength(1)
  })

  it("createWithEvent persists nothing when the EVENT key collides after the attempt row was added", async () => {
    const name = freshName()
    const store = await JournalStore.open(name)

    // A stray event (att-1, 1) with no attempt row, as a crash could leave.
    await store.putAttempt(makeLocalState())
    await store.append("att-1", { type: "start", clientAt: at, payload: {} })
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name)

      request.onsuccess = () => {
        const tx = request.result.transaction("attempts", "readwrite")

        tx.objectStore("attempts").delete("att-1")
        tx.oncomplete = () => {
          request.result.close()
          resolve()
        }
        tx.onerror = () => {
          reject(tx.error ?? new Error("delete failed"))
        }
      }
    })

    await expect(
      store.createWithEvent(makeLocalState(), {
        type: "start",
        clientAt: at,
        payload: {},
      }),
    ).rejects.toThrow()
    expect(await store.getAttempt("att-1")).toBeNull()
  })

  it("saveClockHighWater never decreases the stored mark", async () => {
    const store = await JournalStore.open(freshName())

    await store.saveClockHighWater(2000)
    await store.saveClockHighWater(1000)

    expect(await store.loadClockHighWater()).toBe(2000)
  })

  it("round-trips the clock high-water mark", async () => {
    const store = await JournalStore.open(freshName())

    expect(await store.loadClockHighWater()).toBeNull()

    await store.saveClockHighWater(1234)

    expect(await store.loadClockHighWater()).toBe(1234)
  })
})
