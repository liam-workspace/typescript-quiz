import {
  nodeEnvironment,
  parseIntegerEnv,
  type Environment,
} from "@liam-public/node-config"

export interface DbConfig {
  databaseUrl: string
  requestTimeoutMs: number
  jobTimeoutMs: number
  poolMax: number
}

export function loadDbConfig(env: Environment = nodeEnvironment()): DbConfig {
  const databaseUrl = env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required")
  }

  return {
    databaseUrl,
    requestTimeoutMs: parseIntegerEnv(env, "DB_REQUEST_TIMEOUT_MS", 5_000),
    jobTimeoutMs: parseIntegerEnv(env, "DB_JOB_TIMEOUT_MS", 300_000),
    poolMax: parseIntegerEnv(env, "DB_POOL_MAX", 10),
  }
}
