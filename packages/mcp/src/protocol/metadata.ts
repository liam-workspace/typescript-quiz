import type { GatewayConfig } from "../config.js"

export const METADATA_PATHS = [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
] as const

export function protectedResourceMetadata(config: GatewayConfig): object {
  return {
    resource: `${config.publicOrigin}/mcp`,
    authorization_servers: [config.authorizationServer],
    bearer_methods_supported: ["header"],
  }
}

export function resourceMetadataUrl(config: GatewayConfig): string {
  return `${config.publicOrigin}${METADATA_PATHS[0]}`
}
