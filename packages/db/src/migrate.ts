import { runMigrations } from "@liam-workspace/node-postgres"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Runs at API startup. `migrationsTable` is scoped so this service can share a
 * database with another without the two fighting over one migrations table.
 */
export async function migrateToLatest(databaseUrl: string): Promise<void> {
  await runMigrations(databaseUrl, resolve(here, "../migrations"), {
    migrationsTable: "pp_migrations",
  })
}
