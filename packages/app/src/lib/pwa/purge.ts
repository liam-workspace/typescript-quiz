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

export type PurgeStep = () => Promise<void> | void

const steps = new Set<PurgeStep>()
let inFlight: Promise<void> | null = null

/**
 * Registers a step to run on every purge; returns its unregister function.
 * Steps START SYNCHRONOUSLY, in registration order, inside the
 * `purgeClientCaches()` call itself: a step that needs the bearer token (the
 * reminder unsubscribe) reads it in its first synchronous lines, because
 * `signOut()` clears the token right after calling the purge.
 */
export function registerPurgeStep(step: PurgeStep): () => void {
  steps.add(step)

  return () => {
    steps.delete(step)
  }
}

/** Test-only seam. */
export function resetPurgeStepsForTests(): void {
  steps.clear()
  inFlight = null
}

function startStep(step: PurgeStep): Promise<void> {
  try {
    return Promise.resolve(step())
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new Error(String(error)),
    )
  }
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

/**
 * Never rejects; idempotent. A purge requested while one is running joins it
 * (a step that triggers a 401 would otherwise re-enter through
 * clearSessionAndRedirectToSignIn → signOut → purge).
 */
export function purgeClientCaches(): Promise<void> {
  inFlight ??= Promise.allSettled([
    // Steps first and synchronously (see registerPurgeStep).
    ...[...steps].map(startStep),
    deleteCaches(),
    ...DATABASE_NAMES.map(deleteDatabase),
  ])
    .then(() => undefined)
    .finally(() => {
      inFlight = null
    })

  return inFlight
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
