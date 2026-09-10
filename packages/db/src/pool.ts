import { createPool } from "@liam-workspace/node-postgres"
import type pg from "pg"
import type { DbConfig } from "./config.js"

/**
 * Request path. Fails fast, so a hung database rejects rather than hangs and
 * takes every request with it.
 */
export function createRequestPool(cfg: DbConfig): pg.Pool {
  return createPool(cfg.databaseUrl, {
    connectionTimeoutMillis: 2_000,
    statementTimeoutMillis: cfg.requestTimeoutMs,
    queryTimeoutMillis: cfg.requestTimeoutMs,
    max: cfg.poolMax,
    applicationName: "pp:api",
  })
}

/**
 * Import, seed and rescore. Long statements are expected and correct here, so
 * this pool must NOT share the request path's deadlines — a 40-question
 * import would be cancelled part-way by a 5s statement_timeout.
 */
export function createJobPool(cfg: DbConfig): pg.Pool {
  return createPool(cfg.databaseUrl, {
    connectionTimeoutMillis: 5_000,
    statementTimeoutMillis: cfg.jobTimeoutMs,
    max: 2,
    applicationName: "pp:jobs",
  })
}
