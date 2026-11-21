/**
 * Spec D8 — what a sign-out (or a different student signing in) must wipe
 * from this browser. NOT wiped here: the answer queue and any unsynced
 * attempt journal — unsent answers must survive a sign-out so they flush
 * after the next sign-in (api-client.ts). Later tasks that own other
 * stores add their own step with `registerPurgeStep` instead of editing
 * this file.
 */
const CACHE_NAMES = ["pp-api-v1", "pp-offline-media-v1"] as const
const DATABASE_NAMES = ["pp-offline"] as const
const LAST_STUDENT_KEY = "pp.last-student"

type PurgeStep = () => Promise<void>

let steps: PurgeStep[] = []

export function registerPurgeStep(step: PurgeStep): void {
  steps.push(step)
}

/** Test-only seam. */
export function resetPurgeStepsForTests(): void {
  steps = []
}

async function deleteCaches(): Promise<void> {
  if (typeof caches === "undefined") {
    return
  }

  await Promise.all(CACHE_NAMES.map((name) => caches.delete(name)))
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name)

      // A blocked delete completes as soon as the other connection closes;
      // waiting on it would stall sign-out, so settle on all three.
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}

/** Never rejects; idempotent. */
export async function purgeClientCaches(): Promise<void> {
  await Promise.allSettled([
    deleteCaches(),
    ...DATABASE_NAMES.map(deleteDatabase),
    ...steps.map((step) => Promise.resolve().then(step)),
  ])
}

/**
 * Called after a successful sign-in. A different student on the same
 * browser must not inherit the previous student's cached data even if the
 * previous session ended without a clean sign-out (expired refresh token).
 */
export async function purgeIfSubjectChanged(subject: string): Promise<void> {
  try {
    const previous = globalThis.localStorage.getItem(LAST_STUDENT_KEY)

    globalThis.localStorage.setItem(LAST_STUDENT_KEY, subject)

    if (previous !== null && previous !== subject) {
      await purgeClientCaches()
    }
  } catch {
    // Storage unavailable: nothing to compare against, nothing to purge.
  }
}
