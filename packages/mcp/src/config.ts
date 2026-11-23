import process from "node:process"

export interface GatewayConfig {
  readonly publicOrigin: string
  readonly authorizationServer: string
  readonly apiBaseUrl: string
  readonly port: number
  readonly bindHost: string
  readonly apiTimeoutMs: number
  readonly allowedOrigins: readonly string[]
}

type Environment = Readonly<Record<string, string | undefined>>

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function parseBareOrigin(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required`)
  }

  const url = tryParseUrl(value)

  if (!url) {
    throw new Error(`${name} must be a bare origin`)
  }

  const loopback = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)

  if (
    url.origin === "null" ||
    url.origin !== value ||
    (url.protocol !== "https:" && !loopback)
  ) {
    throw new Error(
      `${name} must be a bare origin using HTTPS unless it is loopback`,
    )
  }

  return value
}

interface IntegerBounds {
  readonly fallback: number
  readonly minimum: number
  readonly maximum: number
}

function parseInteger(
  name: string,
  value: string | undefined,
  { fallback, minimum, maximum }: IntegerBounds,
): number {
  if (!value) {
    return fallback
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a whole number`)
  }

  const number = Number(value)

  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`)
  }

  return number
}

function parseBindHost(value: string | undefined): string {
  const host = value ?? "127.0.0.1"

  if (!host || /\s/.test(host)) {
    throw new Error("MCP_BIND_HOST must be a non-empty host name or IP address")
  }

  return host
}

function parseAllowedOrigins(value: string | undefined): readonly string[] {
  if (!value) {
    return Object.freeze([])
  }

  return Object.freeze(
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
      .map((origin) => parseBareOrigin("MCP_ALLOWED_ORIGINS", origin)),
  )
}

export function loadGatewayConfig(env: Environment): GatewayConfig {
  return Object.freeze({
    publicOrigin: parseBareOrigin("MCP_PUBLIC_ORIGIN", env.MCP_PUBLIC_ORIGIN),
    authorizationServer: parseBareOrigin(
      "MCP_AUTHORIZATION_SERVER",
      env.MCP_AUTHORIZATION_SERVER,
    ),
    apiBaseUrl: parseBareOrigin("API_BASE_URL", env.API_BASE_URL),
    port: parseInteger("MCP_PORT", env.MCP_PORT, {
      fallback: 3100,
      minimum: 1,
      maximum: 65_535,
    }),
    bindHost: parseBindHost(env.MCP_BIND_HOST),
    apiTimeoutMs: parseInteger("MCP_API_TIMEOUT_MS", env.MCP_API_TIMEOUT_MS, {
      fallback: 10_000,
      minimum: 1_000,
      maximum: 60_000,
    }),
    allowedOrigins: parseAllowedOrigins(env.MCP_ALLOWED_ORIGINS),
  })
}

export function loadGatewayConfigFromProcess(): GatewayConfig {
  return loadGatewayConfig(process.env)
}
