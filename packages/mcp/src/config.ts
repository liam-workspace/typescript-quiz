import process from "node:process"

export interface GatewayConfig {
  readonly publicOrigin: string
  readonly authorizationServer: string
  readonly apiBaseUrl: string
  readonly port: number
  readonly apiTimeoutMs: number
  readonly allowedOrigins: readonly string[]
}

type Environment = Readonly<Record<string, string | undefined>>

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

function parseBareOrigin(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required`)
  }

  let url: URL

  try {
    url = new URL(value)
  } catch {
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

function parseInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
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
    port: parseInteger("MCP_PORT", env.MCP_PORT, 3100, 1, 65_535),
    apiTimeoutMs: parseInteger(
      "MCP_API_TIMEOUT_MS",
      env.MCP_API_TIMEOUT_MS,
      10_000,
      1_000,
      60_000,
    ),
    allowedOrigins: parseAllowedOrigins(env.MCP_ALLOWED_ORIGINS),
  })
}

export function loadGatewayConfigFromProcess(): GatewayConfig {
  return loadGatewayConfig(process.env)
}
