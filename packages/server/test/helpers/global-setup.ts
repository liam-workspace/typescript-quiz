import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
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
  defaultSpaRootToLocalBuild()

  const container = await new PostgreSqlContainer("postgres:16-alpine").start()
  project.provide("postgresConnectionUri", container.getConnectionUri())

  return async () => {
    await container.stop()
  }
}

/**
 * `spa.e2e.test.ts` skips itself unless `SPA_ROOT` points at a real
 * directory, which only the Docker image sets. That is the right guard --
 * but it meant the SPA suite skipped on every ordinary `pnpm test`, leaving
 * the fallback filter (the one piece of that task with genuinely surprising
 * behaviour) unexercised by the gate that is supposed to cover it.
 *
 * `pnpm lint` runs `pnpm build`, which builds `packages/app`, so the dist
 * is there locally too -- only the variable was missing. Point at it when
 * it exists and leave any explicit SPA_ROOT alone. Still skips on a clean
 * checkout that has never built, which is the case the guard is for.
 */
function defaultSpaRootToLocalBuild(): void {
  if (process.env.SPA_ROOT) {
    return
  }

  const here = dirname(fileURLToPath(import.meta.url))
  const dist = resolve(here, "../../../app/dist")

  if (existsSync(resolve(dist, "index.html"))) {
    process.env.SPA_ROOT = dist
  }
}
