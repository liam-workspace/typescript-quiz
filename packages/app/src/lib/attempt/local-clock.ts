export interface LocalClockDeps {
  readonly wallNow: () => number
  readonly monoNow: () => number
  readonly loadHighWater: () => Promise<number | null>
  readonly saveHighWater: (ms: number) => Promise<void>
}

/**
 * The clock an OFFLINE section deadline is judged by. The server only sees the
 * journal's claimed times, so all this class can defend is "a student cannot
 * gain time by rewinding the phone's clock".
 *
 * per observation `elapsed += monotonic delta`, or the wall delta when the wall is ahead by more than `SLEEP_THRESHOLD_MS`:
 *   - wall set BACKWARDS: ignored, the monotonic clock keeps counting;
 *   - wall jumped FORWARDS (or the device slept while `performance.now()`
 *     paused): trusted, it can only cost the student time;
 *   - a persisted high-water mark gives the same guarantee across reloads.
 * `nowMs()` never decreases.
 */
/**
 * `Date.now()` ticks in whole milliseconds and `performance.now()` in about
 * 0.1 ms, so per observation `wall delta - mono delta` is noise in roughly
 * (-1, +1) ms. Taking a plain `max` per call keeps only the positive half and
 * the bias accumulates with call frequency (about +32 s per hour at one call
 * per frame). The wall clock therefore only wins when it is ahead of the
 * monotonic clock by more than this dead band, which every real sleep/suspend
 * and every deliberate forward wall jump exceeds by far.
 */
export const SLEEP_THRESHOLD_MS = 2000

export class LocalClock {
  private readonly deps: LocalClockDeps
  private readonly base: number
  private lastWall: number
  private lastMono: number
  private elapsed = 0
  private high: number

  private constructor(deps: LocalClockDeps, stored: number | null) {
    this.deps = deps
    this.lastWall = deps.wallNow()
    this.lastMono = deps.monoNow()
    this.base = Math.max(this.lastWall, stored ?? 0)
    this.high = this.base
  }

  static async create(deps: LocalClockDeps): Promise<LocalClock> {
    return new LocalClock(deps, await deps.loadHighWater())
  }

  /**
   * Elapsed time is accumulated per observation, so a wall rewind never
   * "banks" a negative delta that would swallow a later sleep.
   */
  nowMs(): number {
    const wall = this.deps.wallNow()
    const mono = this.deps.monoNow()

    const dMono = Math.max(0, mono - this.lastMono)
    const dWall = wall - this.lastWall

    this.elapsed += dWall - dMono > SLEEP_THRESHOLD_MS ? dWall : dMono
    this.lastWall = wall
    this.lastMono = mono
    this.high = Math.max(this.high, this.base + this.elapsed)

    return this.high
  }

  /** Best effort: a failed save must never surface as an unhandled rejection. */
  async persist(): Promise<void> {
    try {
      await this.deps.saveHighWater(this.high)
    } catch {
      // The next append also raises the stored mark.
    }
  }
}
