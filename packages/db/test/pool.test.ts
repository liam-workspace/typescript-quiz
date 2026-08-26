import { describe, expect, it } from "vitest"
import { createFixedClock, systemClock } from "@pp/common"
import { loadDbConfig } from "../src/config.js"
import { createJobPool, createRequestPool } from "../src/pool.js"
import { withDatabase } from "./helpers/database.js"

describe("config", () => {
  it("reads bounded defaults and honours overrides", () => {
    const base = loadDbConfig({ DATABASE_URL: "postgres://x/y" })

    expect(base.requestTimeoutMs).toBe(5_000)
    expect(base.jobTimeoutMs).toBe(300_000)

    const tuned = loadDbConfig({
      DATABASE_URL: "postgres://x/y",
      DB_REQUEST_TIMEOUT_MS: "1200",
      DB_POOL_MAX: "4",
    })

    expect(tuned.requestTimeoutMs).toBe(1_200)
    expect(tuned.poolMax).toBe(4)
  })

  it("refuses to start without a DATABASE_URL", () => {
    expect(() => loadDbConfig({})).toThrow(/DATABASE_URL/)
  })
})

describe("pools", () => {
  it("names itself in pg_stat_activity so an incident can attribute connections", async () => {
    await withDatabase(async (_pool, handle) => {
      const cfg = loadDbConfig({ DATABASE_URL: handle.databaseUrl })

      // Two pools, checked one after another: each query and teardown
      // must complete before the next pool opens, so this cannot become
      // Promise.all without connecting both pools at once for no reason.
      /* eslint-disable no-await-in-loop */
      for (const [make, expected] of [
        [createRequestPool, "pp:api"],
        [createJobPool, "pp:jobs"],
      ] as const) {
        const p = make(cfg)
        const { rows } = await p.query<{ application_name: string }>(
          "SELECT current_setting('application_name') AS application_name",
        )

        expect(rows[0].application_name).toBe(expected)
        await p.end()
      }
      /* eslint-enable no-await-in-loop */
    })
  }, 120_000)
})

describe("clock", () => {
  it("createFixedClock lets an expiry test assert instead of sleep", () => {
    const at = new Date("2026-08-25T08:52:40Z")

    expect(createFixedClock(at).now().toISOString()).toBe(
      "2026-08-25T08:52:40.000Z",
    )
    expect(systemClock.now().getTime()).toBeGreaterThan(0)
  })
})
