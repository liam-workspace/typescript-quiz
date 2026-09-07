import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createPool, waitForDatabase } from "@liam-public/node-postgres"
import { describe, expect, inject, it } from "vitest"

const run = promisify(execFile)

/**
 * Node's real resolver, not Vite's. Plan 1 shipped packages that every test
 * could import and no Node process could, because vitest resolved the `.js`
 * specifiers Node takes literally. This test is the only thing that notices.
 */
describe("built output", () => {
  it("loads @pp/db in a plain Node ESM process", async () => {
    const { stdout } = await run("node", [
      "--input-type=module",
      "-e",
      'const m = await import("@pp/db"); console.log(typeof m.migrateToLatest)',
    ])
    expect(stdout.trim()).toBe("function")
  })

  it("loads @pp/common in a plain Node ESM process", async () => {
    const { stdout } = await run("node", [
      "--input-type=module",
      "-e",
      'const m = await import("@pp/common"); console.log(typeof m.asStudentId)',
    ])
    expect(stdout.trim()).toBe("function")
  })

  it("runs migrateToLatest from the built package against a real database", async () => {
    const databaseUrl = inject("postgresConnectionUri")
    await waitForDatabase(databaseUrl, { retries: 20, delayMs: 250 })
    const pool = createPool(databaseUrl, { applicationName: "pp:test" })

    try {
      await pool.query(
        "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
      )

      // `migrateToLatest` resolves its migrations directory relative to its
      // own compiled location (`resolve(here, "../migrations")`). Running it
      // from the *built* @pp/db package, in a plain Node subprocess with no
      // access to this repo's `src/`, is what actually exercises that the
      // path still lands on packages/db/migrations from `dist/`.
      await run("node", [
        "--input-type=module",
        "-e",
        'const { migrateToLatest } = await import("@pp/db"); await migrateToLatest(process.argv[1])',
        "--",
        databaseUrl,
      ])

      const { rows } = await pool.query<{ exists: boolean }>(
        "SELECT to_regclass('public.pp_migrations') IS NOT NULL AS exists",
      )
      expect(rows[0]?.exists).toBe(true)
    } finally {
      await pool.end()
    }
  }, 120_000)
})
