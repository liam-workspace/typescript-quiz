export interface NetworkSnapshot {
  readonly online: boolean
}

type Listener = () => void

const PROBE_INTERVAL_MS = 5000

/**
 * `navigator.onLine` only says whether a network interface is up; a phone
 * on captive wifi reports `true` while every request fails. So the store
 * combines the browser signal with what real requests report:
 * `api-client.ts` calls `reportFetchFailure()` when a request rejects with
 * a TypeError and `reportFetchSuccess()` on any response. After a failure
 * it probes `/health` every 5 s (outside /api, so the worker's allow-list
 * and the bearer header are irrelevant) until the server answers.
 */
async function defaultProbe(): Promise<boolean> {
  try {
    const response = await fetch("/health", { cache: "no-store" })

    return response.ok
  } catch {
    return false
  }
}

let browserOnline = true
let failed = false
let snapshot: NetworkSnapshot = { online: true }
let probe: () => Promise<boolean> = defaultProbe
let probeTimer: ReturnType<typeof setInterval> | undefined = undefined
const listeners = new Set<Listener>()

function recompute(): void {
  const next = browserOnline && !failed

  if (next === snapshot.online) {
    return
  }

  snapshot = { online: next }

  for (const listener of [...listeners]) {
    listener()
  }
}

function stopProbe(): void {
  if (probeTimer !== undefined) {
    clearInterval(probeTimer)
    probeTimer = undefined
  }
}

function startProbe(): void {
  if (probeTimer !== undefined) {
    return
  }

  probeTimer = setInterval(() => {
    void probe().then((ok) => {
      if (ok) {
        networkStore.reportFetchSuccess()
      }
    })
  }, PROBE_INTERVAL_MS)
}

export const networkStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot(): NetworkSnapshot {
    return snapshot
  },
  reportFetchFailure(): void {
    failed = true
    startProbe()
    recompute()
  },
  reportFetchSuccess(): void {
    failed = false
    stopProbe()
    recompute()
  },
  setOnlineForTests(online: boolean): void {
    browserOnline = online
    failed = false
    stopProbe()
    recompute()
  },
}

export function setRecoveryProbeForTests(next: () => Promise<boolean>): void {
  probe = next
}

export function resetNetworkStoreForTests(): void {
  stopProbe()
  browserOnline = true
  failed = false
  probe = defaultProbe
  snapshot = { online: true }
  listeners.clear()
}

if (typeof window !== "undefined") {
  browserOnline = navigator.onLine
  snapshot = { online: browserOnline }
  window.addEventListener("online", () => {
    browserOnline = true
    failed = false
    stopProbe()
    recompute()
  })
  window.addEventListener("offline", () => {
    browserOnline = false
    recompute()
  })
}
