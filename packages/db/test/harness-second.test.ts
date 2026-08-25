import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"

// Exists to prove withDatabase reuses the single container published by
// globalSetup across test FILES, not just within one file's it() blocks.
// See packages/db/test/helpers/global-setup.ts.
describe("test harness (second file)", () => {
  it("shares the container started by globalSetup", async () => {
    await withDatabase(async (pool) => {
      const { rows } = await pool.query<{ answer: number }>(
        "SELECT 1 AS answer",
      )
      expect(rows[0].answer).toBe(1)
    })
  }, 120_000)
})
