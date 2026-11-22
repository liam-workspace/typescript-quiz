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
 * `elapsed += max(monotonic delta, wall delta)` per observation:
 *   - wall set BACKWARDS: ignored, the monotonic clock keeps counting;
 *   - wall jumped FORWARDS (or the device slept while `performance.now()`
 *     paused): trusted, it can only cost the student time;
 *   - a persisted high-water mark gives the same guarantee across reloads.
 * `nowMs()` never decreases.
 */
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

    this.elapsed += Math.max(0, mono - this.lastMono, wall - this.lastWall)
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
