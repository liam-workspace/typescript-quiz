import {
  nodeEnvironment,
  parseCsvEnv,
  parseIntegerEnv,
  type Environment,
} from "@liam-public/node-config"

export interface ServerConfig {
  port: number
  databaseUrl: string
  jwksUrl: string
  mediaRoot: string
  mediaMaxBytes: number
  allowedEmails: string[]
}

function required(env: Environment, key: string): string {
  const value = env[key]

  if (!value) {
    throw new Error(`${key} is required`)
  }

  return value
}

export function loadServerConfig(
  env: Environment = nodeEnvironment(),
): ServerConfig {
  return {
    port: parseIntegerEnv(env, "PORT", 3000),
    databaseUrl: required(env, "DATABASE_URL"),
    jwksUrl: required(env, "JWKS_URL"),
    mediaRoot: env.MEDIA_ROOT ?? "/media",
    mediaMaxBytes: parseIntegerEnv(env, "MEDIA_MAX_BYTES", 20 * 1024 * 1024),
    allowedEmails: [...parseCsvEnv(env, "ALLOWED_EMAILS")],
  }
}
