import { AnswerQueue } from "../answerQueue.js"
import i18n from "../../i18n.js"
import { networkStore } from "../network.js"
import { offlineStore } from "../offline/offline-store.js"
import { toastStore } from "../toast.js"
import { HybridAttemptGateway } from "./hybrid-gateway.js"
import { JournalStore } from "./journal-store.js"
import {
  createJournalSync,
  postOfflineSync,
  type JournalSync,
} from "./journal-sync.js"
import { LocalAttemptGateway } from "./local-gateway.js"
import { LocalClock } from "./local-clock.js"
import { currentSubject } from "./owner.js"
import { RemoteAttemptGateway } from "./remote-gateway.js"
import { syncStatus } from "./sync-status.js"

export interface AttemptRuntime {
  readonly gateway: HybridAttemptGateway
  readonly local: LocalAttemptGateway
  readonly sync: JournalSync
  readonly journal: JournalStore
}

let runtime: Promise<AttemptRuntime> | undefined = undefined

/** Opens IndexedDB once and wires the production gateway graph. Lazy: never runs at import. */
export function getAttemptRuntime(): Promise<AttemptRuntime> {
  runtime ??= build().catch((error: unknown) => {
    // A transient open failure must not disable offline attempts for the
    // rest of the tab: the next caller tries again.
    runtime = undefined

    throw error
  })

  return runtime
}

const isOnline = (): boolean => networkStore.getSnapshot().online

async function build(): Promise<AttemptRuntime> {
  const journal = await JournalStore.open()
  // ONE clock for the whole tab: it stamps every event's clientAt, judges
  // every local deadline and stamps every sync's clientSentAt.
  const clock = await LocalClock.create({
    wallNow: () => Date.now(),
    monoNow: () => performance.now(),
    loadHighWater: () => journal.loadClockHighWater(),
    saveHighWater: (ms) => journal.saveClockHighWater(ms),
  })

  // Each append raises the stored mark atomically; these cover the time
  // between appends, so a reload cannot rewind the clock by much.
  window.setInterval(() => void clock.persist(), 5_000)
  document.addEventListener("visibilitychange", () => void clock.persist())
  window.addEventListener("pagehide", () => void clock.persist())

  const sync = createJournalSync({
    journal,
    post: postOfflineSync,
    openQueue: () => AnswerQueue.open(),
    scheduler: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      }),
    clockNow: () => clock.nowMs(),
    isOnline,
    currentSub: currentSubject,
    onSynced: ({ answersAcked }) => {
      toastStore.show(
        i18n.t("runner:toast.backOnline", { count: answersAcked }),
        "cloud",
      )
    },
    status: syncStatus,
  })
  const local = new LocalAttemptGateway({
    journal,
    clock,
    bundles: offlineStore,
    newId: () => crypto.randomUUID(),
    objectUrl: (blob) => URL.createObjectURL(blob),
    requestSync: () => {
      sync.request()
    },
    ownerSub: currentSubject,
  })
  const gateway = new HybridAttemptGateway({
    remote: new RemoteAttemptGateway(),
    local,
    journal,
    sync,
    isOnline,
  })

  return { gateway, local, sync, journal }
}
