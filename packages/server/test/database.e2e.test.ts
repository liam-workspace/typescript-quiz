import type { PgPool } from "@liam-public/node-postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestApp, type TestApp } from "./helpers/app.js"
import { JOB_POOL, REQUEST_POOL } from "../src/database/tokens.js"

describe("database wiring", () => {
  let app: TestApp | undefined = undefined

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app?.close()
  })

  it("names the two pools distinctly in pg_stat_activity", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    const request = app.get<PgPool>(REQUEST_POOL)
    const jobs = app.get<PgPool>(JOB_POOL)

    const results = await Promise.all(
      [request, jobs].map((pool) =>
        pool.query<{ name: string }>(
          "SELECT current_setting('application_name') AS name",
        ),
      ),
    )
    const names = new Set(results.map(({ rows }) => rows[0].name))

    expect(names).toEqual(new Set(["pp:api", "pp:jobs"]))
  })

  it("has already migrated the database by the time the app is up", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    const request = app.get<PgPool>(REQUEST_POOL)
    const { rows } = await request.query<{ count: string }>(
      "SELECT count(*) AS count FROM pp_migrations",
    )
    expect(Number(rows[0].count)).toBeGreaterThan(0)
  })
})
