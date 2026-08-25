import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"

describe("test harness", () => {
  it("gives a live PostgreSQL 16 connection", async () => {
    await withDatabase(async (pool) => {
      const { rows } = await pool.query<{ version: string }>("SELECT version()")
      expect(rows[0].version).toContain("PostgreSQL 16")

      const { rows: settingRows } = await pool.query<{
        application_name: string
      }>("SELECT current_setting('application_name') AS application_name")
      expect(settingRows[0].application_name).toBe("pp:test")
    })
  }, 120_000)
})
