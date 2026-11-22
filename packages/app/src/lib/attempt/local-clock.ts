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
 * `elapsed = max(monotonic delta, wall delta)` measured from open:
 *   - wall set BACKWARDS: ignored, the monotonic clock keeps counting;
 *   - wall jumped FORWARDS (or the device slept while `performance.now()`
 *     paused): trusted, it can only cost the student time;
 *   - a persisted high-water mark gives the same guarantee across reloads.
 * `nowMs()` never decreases.
 */
export class LocalClock {
  private readonly deps: LocalClockDeps
  private readonly openWall: number
  private readonly openMono: number
  private readonly base: number
  private high: number

  private constructor(deps: LocalClockDeps, stored: number | null) {
    this.deps = deps
    this.openWall = deps.wallNow()
    this.openMono = deps.monoNow()
    this.base = Math.max(this.openWall, stored ?? 0)
    this.high = this.base
  }

  static async create(deps: LocalClockDeps): Promise<LocalClock> {
    return new LocalClock(deps, await deps.loadHighWater())
  }

  nowMs(): number {
    const elapsedMono = this.deps.monoNow() - this.openMono
    const elapsedWall = this.deps.wallNow() - this.openWall

    this.high = Math.max(
      this.high,
      this.base + Math.max(0, elapsedMono, elapsedWall),
    )

    return this.high
  }

  persist(): Promise<void> {
    return this.deps.saveHighWater(this.high)
  }
}
