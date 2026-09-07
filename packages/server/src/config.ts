import {
  nodeEnvironment,
  parseIntegerEnv,
  type Environment,
} from "@liam-public/node-config"

export interface ServerConfig {
  port: number
  databaseUrl: string
  jwksUrl: string
  mediaRoot: string
  mediaMaxBytes: number
  accessAppId: string
  accessRole: string
  mediaSigningSecret: string
  requestBodyMaxBytes: number
  spaRoot: string | null
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
    // Non-secret: which client_id's grant in the issuer's `rolesByApp`
    // claim controls sign-in. Defaults to this app's own client id at
    // auth.icovn.me.
    accessAppId: env.ACCESS_APP_ID ?? "quiz-web",
    // Non-secret: the role a user must hold under `accessAppId` to sign in.
    // Defaults to the role already granted there today.
    accessRole: env.ACCESS_ROLE ?? "student",
    // No default: a default signing secret is the secret every deployment
    // would actually ship with, which makes signed URLs forgeable by anyone
    // who has read the source.
    mediaSigningSecret: required(env, "MEDIA_SIGNING_SECRET"),
    // 256 KiB: generous for a section snapshot of dozens of answers, small
    // enough that a runaway client cannot hold a connection open
    // indefinitely.
    requestBodyMaxBytes: parseIntegerEnv(
      env,
      "REQUEST_BODY_MAX_BYTES",
      262_144,
    ),
    // `null` by default: outside Docker (e.g. `pnpm --filter @pp/server
    // start`) there is no built SPA sitting alongside the server, so this
    // must not default to a path that doesn't exist.
    spaRoot: env.SPA_ROOT ?? null,
  }
}
