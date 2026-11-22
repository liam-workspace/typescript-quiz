import type { AnswerQueue } from "../answerQueue.js"
import { ApiError, apiFetch } from "../api-client.js"
import type { Scheduler } from "../flushController.js"
import { classifyForRetry } from "../retryClassifier.js"
import type { JournalStore } from "./journal-store.js"
import type { JournalEventRecord, LocalAttemptState } from "./journal-types.js"
import { isOwnedBy } from "./owner.js"
import type { SyncStatusStore } from "./sync-status.js"

/** `POST /attempts/offline-sync` 200 (server `OfflineSyncResult`). */
export interface OfflineSyncResponse {
  attemptId: string
  ackedThrough: number
  applied: number
  late: number
  rejected: number
  answersAcked: number
  finalized: { status: "expired" | "submitted"; resultUrl: string } | null
}

export interface OfflineSyncBody {
  attemptId: string
  clientSentAt: string
  events: Array<{
    eventSeq: number
    type: string
    clientAt: string
    payload: Readonly<Record<string, unknown>>
  }>
}

export type SyncOutcome =
  | { kind: "nothing" }
  | { kind: "synced"; result: OfflineSyncResponse }
  | { kind: "offline" }
  | { kind: "terminal"; type: string }

/** Runs `task` holding a lock named `name` (one holder at a time, across tabs). */
export type LockRunner = <T>(name: string, task: () => Promise<T>) => Promise<T>

export interface JournalSyncDeps {
  readonly journal: JournalStore
  readonly post: (body: OfflineSyncBody) => Promise<OfflineSyncResponse>
  readonly openQueue: () => Promise<AnswerQueue>
  readonly scheduler: Scheduler
  /**
   * The SAME high-water `LocalClock` that stamps every event's `clientAt`.
   * The server refuses any journal with `clientAt > clientSentAt`, so
   * `Date.now()` (which an NTP step can move back) must never stamp a send.
   */
  readonly clockNow: () => number
  readonly isOnline: () => boolean
  /** The signed-in student's JWT `sub`. Attempts owned by anyone else are invisible to sync. */
  readonly currentSub: () => string | null
  readonly onSynced: (result: {
    attemptId: string
    answersAcked: number
  }) => void
  readonly status: SyncStatusStore
  /** Defaults to Web Locks where available, so two tabs never sync one attempt at once. */
  readonly withLock?: LockRunner
}

export interface JournalSync {
  syncNow(attemptId: string): Promise<SyncOutcome>
  syncAll(): Promise<void>
  /** Debounced: coalesces a burst of appends into one sync. */
  request(): void
}

const MAX_ATTEMPTS = 5
const DEBOUNCE_MS = 1500

/** The request schema's `events.max(500)`. */
export const MAX_EVENTS_PER_REQUEST = 500

export const postOfflineSync = (
  body: OfflineSyncBody,
): Promise<OfflineSyncResponse> =>
  apiFetch<OfflineSyncResponse>("/attempts/offline-sync", {
    method: "POST",
    body: JSON.stringify(body),
  })

/**
 * `navigator.locks` serialises the sync across tabs: a second sync of the
 * same attempt waiting on the server's per-attempt lock could outlast its
 * statement timeout and come back as a retryable 500.
 */
export const webLocks: LockRunner = (name, task) => {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks

  return typeof locks?.request === "function"
    ? (locks.request(name, task) as ReturnType<typeof task>)
    : task()
}

const toWire = (
  event: JournalEventRecord,
): OfflineSyncBody["events"][number] => ({
  eventSeq: event.eventSeq,
  type: event.type,
  clientAt: event.clientAt,
  payload: event.payload,
})

/**
 * A refusal that is a verdict on the journal itself (or on who sent it).
 * 401 is not: `apiFetch` sends the student to sign in, and the journal must
 * go out after that sign-in, not be marked failed. 429/5xx are retried.
 */
const isVerdict = (error: ApiError): boolean =>
  error.problem.status >= 400 &&
  error.problem.status < 500 &&
  error.problem.status !== 401 &&
  error.problem.status !== 429

/** Set as `syncError` when an acknowledgement does not fit what was sent. */
export const ACK_MISMATCH = "offline_sync_ack_mismatch"

/**
 * Defence in depth against a journal numbered below the server's cursor
 * (the server skips those events yet acknowledges through its cursor):
 * acting on such an ack would delete unsent events and their answers.
 *   - an ack BEYOND the last event sent: the server holds history this
 *     journal does not know about;
 *   - a first send of new events that the server processed none of.
 * Either way nothing is deleted or acknowledged, and the sync is failed.
 */
function ackContradictsJournal(
  response: OfflineSyncResponse,
  sent: { readonly lastSent: number; readonly firstSend: boolean },
): boolean {
  const processed = response.applied + response.late + response.rejected

  return (
    response.ackedThrough > sent.lastSent || (sent.firstSend && processed === 0)
  )
}

type Sent =
  | { kind: "ok"; response: OfflineSyncResponse; tries: number }
  | { kind: "offline" }
  | { kind: "terminal"; type: string }

/**
 * Replays this phone's attempt journals to the server (spec D6, §13.1).
 *
 * - `clientSentAt` is stamped afresh on EVERY send, including retries, as
 *   `max(clock, max clientAt)` from the clock that stamped the events.
 * - At most one request per attempt is in flight (in this tab, and across
 *   tabs through `withLock`); events appended meanwhile go in a later,
 *   sequential request, so nothing is sent twice or out of order.
 * - A terminal refusal NEVER deletes anything: the journal and state stay,
 *   `syncError` is set (the sync-failed state), and the journal is not
 *   re-sent, so the server is not asked the same question in a loop.
 */
export function createJournalSync(deps: JournalSyncDeps): JournalSync {
  const withLock = deps.withLock ?? webLocks
  const inflight = new Map<string, Promise<SyncOutcome>>()
  let timer: ReturnType<typeof setTimeout> | undefined = undefined

  const isMine = (state: LocalAttemptState): boolean =>
    isOwnedBy(state, deps.currentSub())

  async function publish(syncing: boolean): Promise<void> {
    const attempts = (await deps.journal.listAttempts()).filter(isMine)
    const counts = await Promise.all(
      attempts.map((a) => deps.journal.pendingCount(a.attemptId)),
    )

    deps.status.set({
      syncing,
      pendingAttempts: counts.filter((count) => count > 0).length,
      pendingEvents: counts.reduce((total, count) => total + count, 0),
      failedAttemptIds: attempts
        .filter((a) => a.syncError !== null)
        .map((a) => a.attemptId),
    })
  }

  async function ackAnswers(
    attemptId: string,
    events: readonly JournalEventRecord[],
    ackedThrough: number,
  ): Promise<void> {
    const queue = await deps.openQueue()

    for (const event of events) {
      if (event.type === "answer" && event.eventSeq <= ackedThrough) {
        const { questionId, seq } = event.payload

        if (typeof questionId === "string" && typeof seq === "number") {
          // eslint-disable-next-line no-await-in-loop
          await queue.ackItem(attemptId, questionId, seq)
        }
      }
    }
  }

  /** One batch, retried with backoff while the network allows. */
  async function send(
    attemptId: string,
    events: readonly JournalEventRecord[],
  ): Promise<Sent> {
    const newest = Math.max(...events.map((e) => Date.parse(e.clientAt)))

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await deps.post({
          attemptId,
          clientSentAt: new Date(
            Math.max(deps.clockNow(), newest),
          ).toISOString(),
          events: events.map(toWire),
        })

        return { kind: "ok", response, tries: attempt }
      } catch (error) {
        if (error instanceof ApiError && isVerdict(error)) {
          return { kind: "terminal", type: error.problem.type }
        }

        const outcome =
          error instanceof ApiError
            ? classifyForRetry(
                { kind: "http-status", status: error.problem.status },
                attempt,
              )
            : classifyForRetry({ kind: "network-error" }, attempt)

        if (!outcome.retry || attempt === MAX_ATTEMPTS || !deps.isOnline()) {
          return { kind: "offline" }
        }

        // eslint-disable-next-line no-await-in-loop
        await deps.scheduler(outcome.backoffMs)

        // The radio may have gone while we waited: wait for `online` instead.
        if (!deps.isOnline()) {
          return { kind: "offline" }
        }
      }
    }

    return { kind: "offline" }
  }

  async function run(attemptId: string): Promise<SyncOutcome> {
    let last: OfflineSyncResponse | null = null
    let answersAcked = 0

    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const state = await deps.journal.getAttempt(attemptId)

      if (!state || !isMine(state)) {
        return { kind: "nothing" }
      }

      if (state.syncError !== null) {
        return { kind: "terminal", type: state.syncError }
      }

      // eslint-disable-next-line no-await-in-loop
      const pending = await deps.journal.eventsAfter(
        attemptId,
        state.syncedThrough,
      )
      const events = pending.slice(0, MAX_EVENTS_PER_REQUEST)

      if (events.length === 0) {
        break
      }

      if (!deps.isOnline()) {
        return { kind: "offline" }
      }

      const lastSent = events.at(-1)?.eventSeq ?? 0
      const sentBefore = state.sentThrough ?? state.syncedThrough

      // eslint-disable-next-line no-await-in-loop
      await deps.journal.update(attemptId, (s) => ({
        ...s,
        sentThrough: Math.max(s.sentThrough ?? 0, lastSent),
      }))

      // eslint-disable-next-line no-await-in-loop
      const sent = await send(attemptId, events)

      if (sent.kind === "terminal") {
        // eslint-disable-next-line no-await-in-loop
        await deps.journal.update(attemptId, (s) => ({
          ...s,
          syncError: sent.type,
        }))

        return sent
      }

      if (sent.kind === "offline") {
        return sent
      }

      const { response } = sent

      if (
        ackContradictsJournal(response, {
          lastSent,
          // Only a FIRST send can prove the server should have applied
          // something: a retry may follow a request that landed.
          firstSend: sent.tries === 1 && sentBefore < lastSent,
        })
      ) {
        // eslint-disable-next-line no-await-in-loop
        await deps.journal.update(attemptId, (s) => ({
          ...s,
          syncError: ACK_MISMATCH,
        }))

        return { kind: "terminal", type: ACK_MISMATCH }
      }

      // eslint-disable-next-line no-await-in-loop
      await deps.journal.markSynced(attemptId, response.ackedThrough)
      // eslint-disable-next-line no-await-in-loop
      await deps.journal.update(attemptId, (s) => ({
        ...s,
        serverKnown: true,
        syncError: null,
      }))
      // eslint-disable-next-line no-await-in-loop
      await ackAnswers(attemptId, events, response.ackedThrough)
      answersAcked += response.answersAcked
      last = response

      if (response.ackedThrough < (events.at(-1)?.eventSeq ?? 0)) {
        // The server held back part of what it was sent: never spin on it.
        break
      }
    }

    if (last === null) {
      return { kind: "nothing" }
    }

    // The server holds everything and the attempt is over there: nothing
    // left on this phone that anyone needs.
    if (
      last.finalized !== null &&
      (await deps.journal.pendingCount(attemptId)) === 0
    ) {
      await deps.journal.deleteAttempt(attemptId)
    }

    if (answersAcked > 0) {
      deps.onSynced({ attemptId, answersAcked })
    }

    return { kind: "synced", result: last }
  }

  async function guarded(attemptId: string): Promise<SyncOutcome> {
    await publish(true)

    try {
      return await withLock(`pp-offline-sync:${attemptId}`, () =>
        run(attemptId),
      )
    } finally {
      await publish(false)
    }
  }

  function syncNow(attemptId: string): Promise<SyncOutcome> {
    const existing = inflight.get(attemptId)

    if (existing) {
      return existing
    }

    const started = guarded(attemptId).finally(() => {
      inflight.delete(attemptId)
    })

    inflight.set(attemptId, started)

    return started
  }

  async function syncAll(): Promise<void> {
    const mine = (await deps.journal.listAttempts()).filter(isMine)

    for (const attempt of mine) {
      // eslint-disable-next-line no-await-in-loop
      await syncNow(attempt.attemptId)
    }

    await publish(false)
  }

  return {
    syncNow,
    syncAll,
    request() {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void syncAll().catch(() => undefined)
      }, DEBOUNCE_MS)
    },
  }
}

/**
 * Sign-out cleanup (spec D8): deletes attempts the server fully holds
 * (known, nothing pending, never refused). Unsynced or refused work is
 * NEVER deleted -- exactly like the answer queue: the next sign-in must
 * still be able to send it, or an adult to recover it.
 */
export async function purgeSyncedAttempts(
  journal: JournalStore,
): Promise<void> {
  for (const attempt of await journal.listAttempts()) {
    if (
      attempt.serverKnown &&
      attempt.syncError === null &&
      // eslint-disable-next-line no-await-in-loop
      (await journal.pendingCount(attempt.attemptId)) === 0
    ) {
      // eslint-disable-next-line no-await-in-loop
      await journal.deleteAttempt(attempt.attemptId)
    }
  }
}
