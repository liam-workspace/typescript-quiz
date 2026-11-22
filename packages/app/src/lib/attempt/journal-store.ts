import type {
  JournalEventRecord,
  JournalEventType,
  LocalAttemptState,
} from "./journal-types.js"

const ATTEMPTS = "attempts"
const EVENTS = "events"
const META = "meta"
const CLOCK_KEY = "clockHighWater"

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  // A failed request bubbles an `error` event (carrying the specific cause,
  // e.g. ConstraintError) and then the transaction aborts: report the cause.
  let cause: DOMException | null = null

  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = (event) => {
      cause = (event.target as IDBRequest | null)?.error ?? null
    }
    tx.onabort = () =>
      reject(cause ?? tx.error ?? new Error("IndexedDB transaction aborted"))
  })

  // Rejections are consumed by the caller's `await done`, or deliberately
  // dropped by `abortQuietly`; never leave one unhandled in between.
  done.catch(() => undefined)

  return done
}

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)

    request.onupgradeneeded = () => {
      const db = request.result

      db.createObjectStore(ATTEMPTS, { keyPath: "attemptId" })
      db.createObjectStore(EVENTS, { keyPath: ["attemptId", "eventSeq"] })
      db.createObjectStore(META, { keyPath: "key" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed"))
  })
}

const eventsRange = (attemptId: string, afterSeq: number): IDBKeyRange =>
  IDBKeyRange.bound(
    [attemptId, afterSeq + 1],
    [attemptId, Number.MAX_SAFE_INTEGER],
  )

export interface JournalEventDraft {
  readonly type: JournalEventType
  readonly clientAt: string
  readonly payload: Readonly<Record<string, unknown>>
}

/**
 * Append-only journal plus the local attempt state it mutates. `append` writes
 * the event AND the state change in one transaction: after a crash the journal
 * and the state can never disagree about what happened.
 *
 * The store owns `nextEventSeq` and `attemptId`; a `mutate` callback cannot
 * skip or reuse a sequence number or move the row, because both are applied
 * AFTER the callback runs. This database is deliberately NOT part of
 * `purgeClientCaches()`: unsynced journals survive sign-out (D8).
 */
export class JournalStore {
  private readonly db: IDBDatabase
  private readonly listeners = new Set<() => void>()

  private constructor(db: IDBDatabase) {
    this.db = db
  }

  static async open(dbName = "pp-attempts"): Promise<JournalStore> {
    return new JournalStore(await openDb(dbName))
  }

  async getAttempt(attemptId: string): Promise<LocalAttemptState | null> {
    const state = await promisify(
      this.db
        .transaction(ATTEMPTS)
        .objectStore(ATTEMPTS)
        .get(attemptId) as IDBRequest<LocalAttemptState | undefined>,
    )

    return state ?? null
  }

  listAttempts(): Promise<LocalAttemptState[]> {
    return promisify(
      this.db
        .transaction(ATTEMPTS)
        .objectStore(ATTEMPTS)
        .getAll() as IDBRequest<LocalAttemptState[]>,
    )
  }

  async putAttempt(state: LocalAttemptState): Promise<void> {
    const tx = this.db.transaction(ATTEMPTS, "readwrite")
    const done = txDone(tx)

    tx.objectStore(ATTEMPTS).put(state)
    await done
  }

  async update(
    attemptId: string,
    mutate: (s: LocalAttemptState) => LocalAttemptState,
  ): Promise<LocalAttemptState | null> {
    const tx = this.db.transaction(ATTEMPTS, "readwrite")
    const done = txDone(tx)

    try {
      const store = tx.objectStore(ATTEMPTS)
      const state = await promisify(
        store.get(attemptId) as IDBRequest<LocalAttemptState | undefined>,
      )

      if (!state) {
        await done

        return null
      }

      const next = {
        ...mutate(state),
        attemptId,
        nextEventSeq: state.nextEventSeq,
      }

      store.put(next)
      await done

      return next
    } catch (error) {
      JournalStore.abortQuietly(tx, done)

      throw error
    }
  }

  /**
   * Check-and-write in ONE transaction: `decide` sees the stored state (or
   * null) and how many of its events are unsynced, and returns the row to
   * write or null to leave it alone. Nothing can append between the check
   * and the write, and the store-owned event counter never moves backwards.
   */
  async replaceIfSettled(
    attemptId: string,
    decide: (
      existing: LocalAttemptState | null,
      pending: number,
    ) => LocalAttemptState | null,
  ): Promise<LocalAttemptState | null> {
    const tx = this.db.transaction([ATTEMPTS, EVENTS], "readwrite")
    const done = txDone(tx)

    try {
      const attempts = tx.objectStore(ATTEMPTS)
      const existing =
        (await promisify(
          attempts.get(attemptId) as IDBRequest<LocalAttemptState | undefined>,
        )) ?? null
      const pending = await promisify(
        tx
          .objectStore(EVENTS)
          .count(eventsRange(attemptId, existing?.syncedThrough ?? 0)),
      )
      const decided = decide(existing, pending)
      const next =
        decided === null
          ? null
          : {
              ...decided,
              attemptId,
              nextEventSeq: Math.max(
                decided.nextEventSeq,
                existing?.nextEventSeq ?? 1,
              ),
            }

      if (next !== null) {
        attempts.put(next)
      }

      await done

      return next
    } catch (error) {
      JournalStore.abortQuietly(tx, done)

      throw error
    }
  }

  async append(
    attemptId: string,
    draft: JournalEventDraft,
    mutate: (s: LocalAttemptState) => LocalAttemptState = (s) => s,
  ): Promise<JournalEventRecord> {
    const tx = this.db.transaction([ATTEMPTS, EVENTS, META], "readwrite")
    const done = txDone(tx)

    try {
      const attempts = tx.objectStore(ATTEMPTS)
      const state = await promisify(
        attempts.get(attemptId) as IDBRequest<LocalAttemptState | undefined>,
      )

      if (!state) {
        throw new Error(`no local attempt ${attemptId}`)
      }

      const meta = tx.objectStore(META)
      const record: JournalEventRecord = {
        attemptId,
        eventSeq: state.nextEventSeq,
        type: draft.type,
        clientAt: await JournalStore.notBelowMark(meta, draft.clientAt),
        payload: draft.payload,
      }
      // Run the callback BEFORE any write so a throw leaves nothing behind.
      // It runs on the state as read INSIDE this transaction, so a callback
      // that validates (and throws) decides against the latest state even
      // when another tab wrote in between: IndexedDB serialises readwrite
      // transactions on overlapping stores.
      const next: LocalAttemptState = {
        ...mutate(state),
        attemptId,
        nextEventSeq: state.nextEventSeq + 1,
      }

      // `add`, not `put`: a colliding key must abort, never overwrite history.
      const added = promisify(tx.objectStore(EVENTS).add(record))

      attempts.put(next)
      await added
      await JournalStore.stampMark(meta, record.clientAt)
      await done
      this.notify()

      return record
    } catch (error) {
      JournalStore.abortQuietly(tx, done)

      throw error
    }
  }

  /**
   * A new attempt and its first event (the offline `start`) in ONE
   * transaction: a crash can never leave an attempt the server would refuse
   * as `start_missing`. Refuses (writes nothing) if the attempt exists.
   */
  async createWithEvent(
    state: LocalAttemptState,
    draft: JournalEventDraft,
  ): Promise<JournalEventRecord> {
    const tx = this.db.transaction([ATTEMPTS, EVENTS, META], "readwrite")
    const done = txDone(tx)

    try {
      const meta = tx.objectStore(META)
      const record: JournalEventRecord = {
        attemptId: state.attemptId,
        eventSeq: 1,
        type: draft.type,
        clientAt: await JournalStore.notBelowMark(meta, draft.clientAt),
        payload: draft.payload,
      }
      const created = promisify(
        tx
          .objectStore(ATTEMPTS)
          .add({ ...state, nextEventSeq: 2, syncedThrough: 0 }),
      )
      const added = promisify(tx.objectStore(EVENTS).add(record))

      // Both settle (the second as an abort once the first fails): never
      // leave one rejecting unobserved.
      await Promise.all([created, added])
      await JournalStore.stampMark(meta, record.clientAt)
      await done
      this.notify()

      return record
    } catch (error) {
      JournalStore.abortQuietly(tx, done)

      throw error
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  /**
   * The mark is >= every journaled clientAt, so stamping at least the mark
   * keeps each attempt's journal non-decreasing even when two tabs (two
   * `LocalClock` instances) write: the server refuses a journal whose time
   * runs backwards (`client_at_backwards`).
   */
  private static async notBelowMark(
    meta: IDBObjectStore,
    clientAt: string,
  ): Promise<string> {
    const row = await promisify(
      meta.get(CLOCK_KEY) as IDBRequest<
        { key: string; value: number } | undefined
      >,
    )
    const stamped = Date.parse(clientAt)

    return row !== undefined && Number.isFinite(stamped) && stamped < row.value
      ? new Date(row.value).toISOString()
      : clientAt
  }

  /**
   * Keep the clock mark >= every journaled clientAt, atomically, so a crash
   * before `persist()` can never let the next event be stamped lower.
   */
  private static async stampMark(
    meta: IDBObjectStore,
    clientAt: string,
  ): Promise<void> {
    const stamped = Date.parse(clientAt)

    if (Number.isFinite(stamped)) {
      await JournalStore.raiseMark(meta, stamped)
    }
  }

  eventsAfter(
    attemptId: string,
    afterSeq: number,
  ): Promise<JournalEventRecord[]> {
    return promisify(
      this.db
        .transaction(EVENTS)
        .objectStore(EVENTS)
        .getAll(eventsRange(attemptId, afterSeq)) as IDBRequest<
        JournalEventRecord[]
      >,
    )
  }

  async pendingCount(attemptId: string): Promise<number> {
    const state = await this.getAttempt(attemptId)

    if (!state) {
      return 0
    }

    return promisify(
      this.db
        .transaction(EVENTS)
        .objectStore(EVENTS)
        .count(eventsRange(attemptId, state.syncedThrough)),
    )
  }

  async markSynced(attemptId: string, ackedThrough: number): Promise<void> {
    const tx = this.db.transaction([ATTEMPTS, EVENTS], "readwrite")
    const done = txDone(tx)

    tx.objectStore(EVENTS).delete(
      IDBKeyRange.bound([attemptId, 0], [attemptId, ackedThrough]),
    )

    const attempts = tx.objectStore(ATTEMPTS)
    const state = await promisify(
      attempts.get(attemptId) as IDBRequest<LocalAttemptState | undefined>,
    )

    if (state) {
      attempts.put({
        ...state,
        syncedThrough: Math.max(state.syncedThrough, ackedThrough),
      })
    }

    await done
  }

  async deleteAttempt(attemptId: string): Promise<void> {
    const tx = this.db.transaction([ATTEMPTS, EVENTS], "readwrite")
    const done = txDone(tx)

    tx.objectStore(ATTEMPTS).delete(attemptId)
    tx.objectStore(EVENTS).delete(
      IDBKeyRange.bound([attemptId, 0], [attemptId, Number.MAX_SAFE_INTEGER]),
    )
    await done
  }

  onAppend(listener: () => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  async loadClockHighWater(): Promise<number | null> {
    const row = await promisify(
      this.db.transaction(META).objectStore(META).get(CLOCK_KEY) as IDBRequest<
        { key: string; value: number } | undefined
      >,
    )

    return row?.value ?? null
  }

  async saveClockHighWater(ms: number): Promise<void> {
    const tx = this.db.transaction(META, "readwrite")
    const done = txDone(tx)

    try {
      await JournalStore.raiseMark(tx.objectStore(META), ms)
      await done
    } catch (error) {
      JournalStore.abortQuietly(tx, done)

      throw error
    }
  }

  /** Read-max-write inside the caller's transaction: the mark never decreases. */
  private static async raiseMark(
    meta: IDBObjectStore,
    ms: number,
  ): Promise<void> {
    const row = await promisify(
      meta.get(CLOCK_KEY) as IDBRequest<
        { key: string; value: number } | undefined
      >,
    )

    if (row === undefined || row.value < ms) {
      meta.put({ key: CLOCK_KEY, value: ms })
    }
  }

  close(): void {
    this.db.close()
  }

  /** Abort (a no-op if it already aborted) and swallow the expected rejection. */
  private static abortQuietly(tx: IDBTransaction, done: Promise<void>): void {
    try {
      tx.abort()
    } catch {
      // Already finished or aborted.
    }

    done.catch(() => undefined)
  }
}
