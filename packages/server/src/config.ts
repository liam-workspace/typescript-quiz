import {
  nodeEnvironment,
  parseBooleanEnv,
  parseIntegerEnv,
  type Environment,
} from "@liam-workspace/node-config"
import {
  isValidHostSuffix,
  normaliseHostSuffixes,
} from "./reminders/push-endpoint.js"

export interface PushConfig {
  readonly publicKey: string
  readonly privateKey: string
  readonly subject: string
}

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
  push: PushConfig | null
  /** Extra push-service host suffixes, on top of the built-in vendors. */
  pushEndpointHosts: readonly string[]
  /** Whether the reminder scheduler's 60 s timer runs (it also needs VAPID). */
  reminderSchedulerEnabled: boolean
}

function required(env: Environment, key: string): string {
  const value = env[key]

  if (!value) {
    throw new Error(`${key} is required`)
  }

  return value
}

/**
 * All three or none. Compose's `${VAR:-}` hands the container EMPTY strings
 * for unset variables, so blank counts as unset; a partial set refuses to
 * boot rather than silently running without reminders.
 */
function loadPushConfig(env: Environment): PushConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? ""
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? ""
  const subject = env.VAPID_SUBJECT?.trim() ?? ""
  const present = [publicKey, privateKey, subject].filter(
    (value) => value.length > 0,
  ).length

  if (present === 0) {
    return null
  }

  if (present < 3) {
    throw new Error(
      "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be set together",
    )
  }

  return { publicKey, privateKey, subject }
}

/**
 * These suffixes ARE the SSRF boundary for push endpoints, so a bad one refuses
 * the boot (naming the entry) instead of silently admitting `com`,
 * `localhost` or `0.1`.
 */
function loadPushEndpointHosts(env: Environment): string[] {
  const suffixes = (env.PUSH_ENDPOINT_HOSTS ?? "").split(",")
  const hosts = normaliseHostSuffixes(suffixes)

  for (const host of hosts) {
    if (!isValidHostSuffix(host)) {
      throw new Error(
        `PUSH_ENDPOINT_HOSTS entry "${host}" is not a valid push-service host suffix (needs two or more DNS labels and an alphabetic last label)`,
      )
    }
  }

  return hosts
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
    push: loadPushConfig(env),
    // Default empty. Only for a push vendor the built-in list lacks.
    pushEndpointHosts: loadPushEndpointHosts(env),
    // On by default, off under NODE_ENV=test (vitest sets it) so a test app
    // that happens to have VAPID set never starts a background sender; a
    // test or an operator can still say `true`/`false` explicitly.
    reminderSchedulerEnabled: parseBooleanEnv(
      env,
      "REMINDER_SCHEDULER_ENABLED",
      env.NODE_ENV !== "test",
    ),
  }
}
