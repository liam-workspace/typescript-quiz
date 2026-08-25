import { createPool, waitForDatabase } from "@liam-public/node-postgres"
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql"
import type pg from "pg"

export interface DatabaseHandle {
  pool: pg.Pool
  databaseUrl: string
}

let container: StartedPostgreSqlContainer | undefined = undefined

/**
 * One container per worker, reused across tests; each call gets a freshly
 * migrated schema. Starting a container per test would triple the suite time
 * for no isolation benefit, because we drop and rebuild the schema anyway.
 */
export async function withDatabase(
  fn: (pool: pg.Pool, handle: DatabaseHandle) => Promise<void>,
): Promise<void> {
  container ??= await new PostgreSqlContainer("postgres:16-alpine").start()
  const databaseUrl = container.getConnectionUri()
  // The same readiness poll the API uses at boot, so the test path and the
  // production path agree about what "the database is up" means.
  await waitForDatabase(databaseUrl, { retries: 20, delayMs: 250 })
  const pool = createPool(databaseUrl, { applicationName: "pp:test" })

  try {
    await pool.query(
      "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
    )
    // The migrateToLatest step arrives in Task 3; until then the harness only
    // proves connectivity.
    await fn(pool, { pool, databaseUrl })
  } finally {
    await pool.end()
  }
}
