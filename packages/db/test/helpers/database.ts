import { createPool, waitForDatabase } from "@liam-workspace/node-postgres"
import type pg from "pg"
import { inject } from "vitest"
import { migrateToLatest } from "../../src/migrate.js"

export interface DatabaseHandle {
  pool: pg.Pool
  databaseUrl: string
}

/**
 * Every call shares the single PostgreSQL 16 container started once for the
 * whole `vitest run` by test/helpers/global-setup.ts (published via
 * vitest's provide/inject, read here with `inject("postgresConnectionUri")`).
 * Each call still gets a freshly reset schema: the container is shared, not
 * the data. `withDatabase` itself never starts or stops a container.
 */
export async function withDatabase(
  fn: (pool: pg.Pool, handle: DatabaseHandle) => Promise<void>,
): Promise<void> {
  const databaseUrl = inject("postgresConnectionUri")
  // The same readiness poll the API uses at boot, so the test path and the
  // production path agree about what "the database is up" means.
  await waitForDatabase(databaseUrl, { retries: 20, delayMs: 250 })
  const pool = createPool(databaseUrl, { applicationName: "pp:test" })

  try {
    await pool.query(
      "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
    )
    await migrateToLatest(databaseUrl)
    await fn(pool, { pool, databaseUrl })
  } finally {
    await pool.end()
  }
}
