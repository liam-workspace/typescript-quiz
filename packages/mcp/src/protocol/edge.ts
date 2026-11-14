import type { RequestHandler, Response } from "express"
import type { GatewayConfig } from "../config.js"
import { resourceMetadataUrl } from "./metadata.js"

const JWT_BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/

export function extractBearer(header: string | undefined): string | undefined {
  const match = header ? JWT_BEARER.exec(header) : undefined
  return match?.[1]
}

export function sendChallenge(res: Response, config: GatewayConfig): void {
  res
    .status(401)
    .setHeader(
      "WWW-Authenticate",
      `Bearer resource_metadata="${resourceMetadataUrl(config)}"`,
    )
    .json({ error: "unauthorized" })
}

export function createOriginGuard(config: GatewayConfig): RequestHandler {
  const expectedHost = new URL(config.publicOrigin).host.toLowerCase()
  const allowedOrigins = new Set([config.publicOrigin, ...config.allowedOrigins])

  return (req, res, next) => {
    const host = req.headers.host?.toLowerCase()
    const origin = req.headers.origin

    if (host !== expectedHost || (origin !== undefined && !allowedOrigins.has(origin))) {
      res.status(403).end()
      return
    }

    next()
  }
}
