export type TimeSource = () => number

/**
 * Creates a remaining-time reader whose device/server offset is fixed at
 * envelope load time. Later device reads advance elapsed time, but the
 * server timestamp remains the authority for where the deadline falls.
 */
export function createServerCountdown(
  expiresAt: string,
  serverTime: string,
  now: TimeSource = Date.now,
): () => number {
  const expiresAtMs = Date.parse(expiresAt)
  const serverOffsetMs = Date.parse(serverTime) - now()
  let previousRemainingMs = Math.max(0, expiresAtMs - (now() + serverOffsetMs))

  return () => {
    const currentRemainingMs = Math.max(
      0,
      expiresAtMs - (now() + serverOffsetMs),
    )

    // A wall clock can jump backward after load. Remaining time may hold
    // steady across that correction, but it must never increase.
    previousRemainingMs = Math.min(previousRemainingMs, currentRemainingMs)

    return previousRemainingMs
  }
}

export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}
