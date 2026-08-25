import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"

describe("test harness", () => {
  it("gives a live PostgreSQL 16 connection", async () => {
    await withDatabase(async (pool) => {
      const { rows } = await pool.query<{ version: string }>("SELECT version()")
      expect(rows[0].version).toContain("PostgreSQL 16")
    })
  }, 120_000)
})
