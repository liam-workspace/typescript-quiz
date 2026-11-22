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

      const record: JournalEventRecord = {
        attemptId,
        eventSeq: state.nextEventSeq,
        type: draft.type,
        clientAt: draft.clientAt,
        payload: draft.payload,
      }
      // Run the callback BEFORE any write so a throw leaves nothing behind.
      const next: LocalAttemptState = {
        ...mutate(state),
        attemptId,
        nextEventSeq: state.nextEventSeq + 1,
      }

      // `add`, not `put`: a colliding key must abort, never overwrite history.
      const added = promisify(tx.objectStore(EVENTS).add(record))

      attempts.put(next)
      await added
      // Keep the clock mark >= every journaled clientAt, atomically, so a crash
      // before `persist()` can never let the next event be stamped lower.
      const stamped = Date.parse(draft.clientAt)

      if (Number.isFinite(stamped)) {
        await JournalStore.raiseMark(tx.objectStore(META), stamped)
      }

      await done
      for (const listener of this.listeners) {
        listener()
      }

      return record
    } catch (error) {
      JournalStore.abortQuietly(tx, done)

      throw error
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
