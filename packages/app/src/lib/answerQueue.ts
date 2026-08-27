const QUEUE_STORE = "answers"
const META_STORE = "meta"
const CLIENT_INSTANCE_KEY = "clientInstanceId"
const SEQ_COUNTER_KEY = "seqCounter"

export interface QueuedAnswer {
  attemptId: string
  sectionId: string
  questionId: string
  clientInstanceId: string
  seq: number
  selectedChoiceIds: string[]
  answeredAt: string
  timeSpentMs: number | null
  terminalRejection: boolean
}

function keyFor(attemptId: string, questionId: string): string {
  return `${attemptId}:${questionId}`
}

function mintClientInstanceId(): string {
  return crypto.randomUUID()
}

function requestErrorOf(request: { error: DOMException | null }): Error {
  return request.error ?? new Error("IndexedDB request failed")
}

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "key" })
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(requestErrorOf(request))
  })
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(requestErrorOf(request))
  })
}

/**
 * Rule 1 (durable before sent) and Ordering's clientInstanceId/seq minting,
 * spec §5 (`docs/api/openapi.yaml`):
 *
 * > Durable before sent. Every answer is written to IndexedDB on tap and
 * > cleared only on a per-item ack, never on request completion.
 * >
 * > clientInstanceId is minted once per install and stored beside the
 * > queue; seq increases within that instance across attempts as well as
 * > within one.
 *
 * clientInstanceId is minted once and stored in the SAME database's meta
 * store, beside the queue. seq is a single counter that increases across
 * attempts as well as within one -- it is never reset per attempt, because
 * the server's guard (`response_client_cursor.last_seq < EXCLUDED.last_seq`,
 * see `packages/db/src/repositories/response.repository.ts`) is per
 * (clientInstanceId, seq): a reset would make a new attempt's early writes
 * look stale forever against a high-water mark left by a previous attempt.
 *
 * recordAnswer writes to the store before any caller can attempt a network
 * call -- this class exposes no method that sends anything over the
 * network, so "durable before sent" is structural, not a matter of call
 * order at the use site.
 */
export class AnswerQueue {
  private readonly db: IDBDatabase
  private readonly instanceId: string

  private constructor(db: IDBDatabase, instanceId: string) {
    this.db = db
    this.instanceId = instanceId
  }

  static async open(dbName = "pp-answer-queue"): Promise<AnswerQueue> {
    const db = await openDb(dbName)
    const instanceId = await AnswerQueue.loadOrMintInstanceId(db)

    return new AnswerQueue(db, instanceId)
  }

  private static async loadOrMintInstanceId(db: IDBDatabase): Promise<string> {
    const tx = db.transaction(META_STORE, "readwrite")
    const store = tx.objectStore(META_STORE)
    const existing = await promisify(
      store.get(CLIENT_INSTANCE_KEY) as IDBRequest<
        { key: string; value: string } | undefined
      >,
    )

    if (existing) {
      return existing.value
    }

    const minted = mintClientInstanceId()

    store.put({ key: CLIENT_INSTANCE_KEY, value: minted })

    return minted
  }

  clientInstanceId(): string {
    return this.instanceId
  }

  private async nextSeq(): Promise<number> {
    const tx = this.db.transaction(META_STORE, "readwrite")
    const store = tx.objectStore(META_STORE)
    const existing = await promisify(
      store.get(SEQ_COUNTER_KEY) as IDBRequest<
        { key: string; value: number } | undefined
      >,
    )
    const next = (existing?.value ?? 0) + 1

    store.put({ key: SEQ_COUNTER_KEY, value: next })

    return next
  }

  /**
   * Durable before sent: this write completes -- and is awaited by the
   * caller -- before any network attempt can begin, because this class has
   * no method that both records an answer and sends it in the same call.
   */
  async recordAnswer(
    input: {
      attemptId: string
      sectionId: string
      questionId: string
      selectedChoiceIds: string[]
      timeSpentMs: number | null
    },
    now: Date,
  ): Promise<QueuedAnswer> {
    const seq = await this.nextSeq()
    const record: QueuedAnswer & { key: string } = {
      key: keyFor(input.attemptId, input.questionId),
      attemptId: input.attemptId,
      sectionId: input.sectionId,
      questionId: input.questionId,
      clientInstanceId: this.instanceId,
      seq,
      selectedChoiceIds: input.selectedChoiceIds,
      answeredAt: now.toISOString(),
      timeSpentMs: input.timeSpentMs,
      terminalRejection: false,
    }

    const tx = this.db.transaction(QUEUE_STORE, "readwrite")
    tx.objectStore(QUEUE_STORE).put(record)
    await promisify(tx.objectStore(QUEUE_STORE).get(record.key))

    return record
  }

  async snapshotForSection(
    attemptId: string,
    sectionId: string,
  ): Promise<QueuedAnswer[]> {
    const tx = this.db.transaction(QUEUE_STORE, "readonly")
    const all = await promisify(
      tx.objectStore(QUEUE_STORE).getAll() as IDBRequest<QueuedAnswer[]>,
    )

    return all.filter(
      (record) =>
        record.attemptId === attemptId &&
        record.sectionId === sectionId &&
        !record.terminalRejection,
    )
  }

  /**
   * Task 10's submit-remainder builder. Has no caller until Task 10; that
   * task's own test exercises it against this same class.
   */
  async snapshotForAttempt(attemptId: string): Promise<QueuedAnswer[]> {
    const tx = this.db.transaction(QUEUE_STORE, "readonly")
    const all = await promisify(
      tx.objectStore(QUEUE_STORE).getAll() as IDBRequest<QueuedAnswer[]>,
    )

    return all.filter(
      (record) => record.attemptId === attemptId && !record.terminalRejection,
    )
  }

  /**
   * Cleared only on a per-item ack, never on request completion (spec §5
   * rule 1) -- and only when the ack is not stale relative to what is
   * queued right now: a newer local edit made while the ack was in flight
   * must survive it. A snapshot flush's 200 envelope carries per-item
   * results; only the items the server actually applied (or judged
   * ignored_stale, which is a settled outcome, not a pending one) are
   * acked here -- callers must never call this for the whole batch just
   * because the HTTP request came back 200.
   */
  async ackItem(
    attemptId: string,
    questionId: string,
    ackedSeq: number,
  ): Promise<void> {
    const key = keyFor(attemptId, questionId)
    const tx = this.db.transaction(QUEUE_STORE, "readwrite")
    const store = tx.objectStore(QUEUE_STORE)
    const current = await promisify(
      store.get(key) as IDBRequest<
        (QueuedAnswer & { key: string }) | undefined
      >,
    )

    if (current && current.seq <= ackedSeq) {
      store.delete(key)
    }
  }

  async markTerminalRejection(
    attemptId: string,
    questionId: string,
  ): Promise<void> {
    const key = keyFor(attemptId, questionId)
    const tx = this.db.transaction(QUEUE_STORE, "readwrite")
    const store = tx.objectStore(QUEUE_STORE)
    const current = await promisify(
      store.get(key) as IDBRequest<
        (QueuedAnswer & { key: string }) | undefined
      >,
    )

    if (current) {
      store.put({ ...current, terminalRejection: true })
    }
  }

  close(): Promise<void> {
    this.db.close()

    return Promise.resolve()
  }
}
