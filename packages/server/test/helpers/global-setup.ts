import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { TestProject } from "vitest/node"

declare module "vitest" {
  export interface ProvidedContext {
    postgresConnectionUri: string
  }
}

/**
 * Runs once for the whole `vitest run` invocation (vitest calls the default
 * export of every `globalSetup` file exactly once, before any test file is
 * collected, regardless of how many files or workers run). Starts a single
 * PostgreSQL 16 container and publishes its connection URI to every test
 * file via `provide`/`inject`, so `withDatabase` never starts a container of
 * its own. The returned function is vitest's teardown hook: it runs after
 * every test file has finished, so cleanup does not depend solely on the
 * testcontainers Ryuk reaper noticing the process exited.
 */
export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer("postgres:16-alpine").start()
  project.provide("postgresConnectionUri", container.getConnectionUri())

  return async () => {
    await container.stop()
  }
}
