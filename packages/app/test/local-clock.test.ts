import { describe, expect, it } from "vitest"
import {
  LocalClock,
  type LocalClockDeps,
} from "../src/lib/attempt/local-clock.js"

function deps(
  wall: { v: number },
  mono: { v: number },
  stored: number | null = null,
): LocalClockDeps & { saved: number[] } {
  const saved: number[] = []

  return {
    wallNow: () => wall.v,
    monoNow: () => mono.v,
    loadHighWater: () => Promise.resolve(stored),
    saveHighWater: (ms) => {
      saved.push(ms)

      return Promise.resolve()
    },
    saved,
  }
}

describe("LocalClock", () => {
  it("advances with time (fresh install, nothing stored)", async () => {
    const wall = { v: 1_000_000 }
    const mono = { v: 0 }
    const clock = await LocalClock.create(deps(wall, mono))

    wall.v += 5_000
    mono.v += 5_000

    expect(clock.nowMs()).toBe(1_005_000)
  })

  it("ignores the wall clock being set backwards (the monotonic clock keeps going)", async () => {
    const wall = { v: 1_000_000 }
    const mono = { v: 0 }
    const clock = await LocalClock.create(deps(wall, mono))

    mono.v += 60_000
    wall.v = 400_000

    expect(clock.nowMs()).toBe(1_060_000)

    mono.v += 1_000
    wall.v += 1_000

    expect(clock.nowMs()).toBe(1_061_000)
  })

  it("counts a wall-clock jump forward", async () => {
    const wall = { v: 1_000_000 }
    const mono = { v: 0 }
    const clock = await LocalClock.create(deps(wall, mono))

    wall.v += 3_600_000
    mono.v += 1_000

    expect(clock.nowMs()).toBe(4_600_000)
  })

  it("counts sleep: monotonic paused while the wall clock ran", async () => {
    const wall = { v: 1_000_000 }
    const mono = { v: 0 }
    const clock = await LocalClock.create(deps(wall, mono))

    wall.v += 600_000
    mono.v += 1_000

    expect(clock.nowMs()).toBe(1_600_000)
  })

  it("never returns an earlier time than it has already returned", async () => {
    const wall = { v: 1_000_000 }
    const mono = { v: 0 }
    const clock = await LocalClock.create(deps(wall, mono))

    mono.v += 10_000

    const first = clock.nowMs()

    wall.v -= 500_000

    expect(clock.nowMs()).toBeGreaterThanOrEqual(first)
  })

  it("a stored high-water mark above the current wall time stops a reload from rewinding", async () => {
    const wall = { v: 500_000 }
    const mono = { v: 0 }
    const clock = await LocalClock.create(deps(wall, mono, 1_000_000))

    expect(clock.nowMs()).toBe(1_000_000)

    mono.v += 2_000
    wall.v += 2_000

    expect(clock.nowMs()).toBe(1_002_000)
  })

  it("after a reload with a mark ahead of the wall, sleep is still counted from the real wall", async () => {
    const wall = { v: 500_000 }
    const mono = { v: 0 }
    const clock = await LocalClock.create(deps(wall, mono, 1_000_000))

    wall.v += 300_000
    mono.v += 1_000

    expect(clock.nowMs()).toBe(1_300_000)
  })

  it("a stored mark below the wall time is ignored", async () => {
    const wall = { v: 2_000_000 }
    const mono = { v: 0 }
    const clock = await LocalClock.create(deps(wall, mono, 1_000_000))

    expect(clock.nowMs()).toBe(2_000_000)
  })

  it("persist writes the current high-water mark", async () => {
    const wall = { v: 1_000_000 }
    const mono = { v: 0 }
    const d = deps(wall, mono)
    const clock = await LocalClock.create(d)

    mono.v += 3_000
    wall.v += 3_000
    clock.nowMs()
    await clock.persist()

    expect(d.saved.at(-1)).toBe(1_003_000)
  })

  it("rewind then sleep: the sleep after a wall rewind is still counted", async () => {
    const wall = { v: 1_000_000 }
    const mono = { v: 0 }
    const clock = await LocalClock.create(deps(wall, mono))

    wall.v += 1_000
    mono.v += 1_000

    expect(clock.nowMs()).toBe(1_001_000)

    // Student sets the clock back an hour

    wall.v -= 3_600_000
    expect(clock.nowMs()).toBe(1_001_000)

    // Phone sleeps 30 min, monotonic paused

    wall.v += 1_800_000
    mono.v += 1_000

    expect(clock.nowMs()).toBe(1_001_000 + 1_800_000)
  })

  it("persist swallows a failing save (no unhandled rejection)", async () => {
    const wall = { v: 1_000_000 }
    const mono = { v: 0 }
    const clock = await LocalClock.create({
      ...deps(wall, mono),
      saveHighWater: () => Promise.reject(new Error("quota")),
    })

    await expect(clock.persist()).resolves.toBeUndefined()
  })

  it("does not drift when called every animation frame for an hour", async () => {
    const start = 1_000_000.37
    const state = { t: 0 }
    // Date.now() floors to whole ms; performance.now() has ~0.1 ms steps.
    const wallNow = (): number => Math.floor(start + state.t)
    const monoNow = (): number => Math.floor(state.t * 10) / 10
    const clock = await LocalClock.create({
      wallNow,
      monoNow,
      loadHighWater: () => Promise.resolve(null),
      saveHighWater: () => Promise.resolve(),
    })
    const first = clock.nowMs()
    // A tiny deterministic jitter so frames are not perfectly regular.
    let seed = 7

    while (state.t < 3_600_000) {
      seed = (seed * 16_807) % 2_147_483_647
      state.t += 16.7 + ((seed % 100) / 100 - 0.5) * 2
      clock.nowMs()
    }

    const drift = Math.abs(clock.nowMs() - first - state.t)

    expect(drift).toBeLessThan(50)
  })

  it("documents the dead band: a 1.5 s wall jump is ignored, 3 s is counted", async () => {
    const wall = { v: 1_000_000 }
    const mono = { v: 0 }
    const clock = await LocalClock.create(deps(wall, mono))

    wall.v += 1_500

    expect(clock.nowMs()).toBe(1_000_000)

    wall.v += 3_000

    expect(clock.nowMs()).toBe(1_003_000)
  })
})
