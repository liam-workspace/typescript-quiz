import { registerPurgeStep } from "../pwa/purge.js"
import type { AttemptGateway } from "./attempt-gateway.js"
import { setAttemptGateway } from "./gateway-selector.js"
import { purgeSyncedAttempts } from "./journal-sync.js"
import { RemoteAttemptGateway } from "./remote-gateway.js"
import { getAttemptRuntime } from "./runtime.js"

/**
 * A gateway that opens the runtime on first use and then delegates to the
 * hybrid. If IndexedDB cannot be opened at all (blocked storage), the app
 * keeps working exactly as it did before offline attempts: remote only.
 */
function lazyHybrid(): AttemptGateway {
  const fallback = new RemoteAttemptGateway()
  const rt = (): Promise<AttemptGateway> =>
    getAttemptRuntime().then(
      (r) => r.gateway,
      () => fallback,
    )

  return {
    start: async (slug, hint) => (await rt()).start(slug, hint),
    loadEnvelope: async (id) => (await rt()).loadEnvelope(id),
    enterSection: async (id, sectionId) =>
      (await rt()).enterSection(id, sectionId),
    setPosition: async (id, sectionId, questionId) =>
      (await rt()).setPosition(id, sectionId, questionId),
    claimPlay: async (id, stimulusId) => (await rt()).claimPlay(id, stimulusId),
    finishSection: async (id, sectionId, body) =>
      (await rt()).finishSection(id, sectionId, body),
    submit: async (id, body) => (await rt()).submit(id, body),
    noteAnswer: async (id, answer) => (await rt()).noteAnswer(id, answer),
    flushAnswers: async (ctx) => (await rt()).flushAnswers(ctx),
    isLocalOnly: async (id) => (await rt()).isLocalOnly(id),
    hasPendingJournal: async (id) => (await rt()).hasPendingJournal(id),
  }
}

/**
 * Called once from `main.tsx`: installs the journal-first gateway, adds the
 * sign-out purge step (synced attempts go; unsynced or refused work stays,
 * spec D8) and starts the sync triggers (spec D6): app start, `online`, and
 * the tab becoming visible again. Appends request a debounced sync
 * themselves. Unit tests never call this, so they keep the remote default.
 */
export function installOfflineAttempts(): void {
  setAttemptGateway(lazyHybrid())
  registerPurgeStep(async () => {
    const { journal } = await getAttemptRuntime()

    await purgeSyncedAttempts(journal)
  })

  void getAttemptRuntime()
    .then(({ sync }) => {
      const syncAll = (): void => {
        void sync.syncAll().catch(() => undefined)
      }

      syncAll()
      window.addEventListener("online", syncAll)
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          syncAll()
        }
      })
    })
    .catch(() => undefined)
}
