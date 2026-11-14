import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import express, { type Express, type Request, type Response } from "express"
import type { GatewayConfig } from "../config.js"
import { ApiError, createApiClient } from "../api/client.js"
import { createOriginGuard, extractBearer, sendChallenge } from "./edge.js"
import { METADATA_PATHS, protectedResourceMetadata } from "./metadata.js"
import { buildMcpServer } from "./mcp-server.js"

function toWebRequest(req: Request, config: GatewayConfig): globalThis.Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (name === "authorization" || value === undefined) continue
    headers.set(name, Array.isArray(value) ? value.join(", ") : value)
  }
  return new globalThis.Request(`${config.publicOrigin}${req.originalUrl}`, {
    method: req.method,
    headers,
  })
}

async function sendWebResponse(
  res: Response,
  response: globalThis.Response,
): Promise<void> {
  res.status(response.status)
  response.headers.forEach((value, name) => res.setHeader(name, value))
  res.end(Buffer.from(await response.arrayBuffer()))
}

function rejectBatch(req: Request, res: Response, next: () => void): void {
  if (Array.isArray(req.body)) {
    res
      .status(400)
      .json({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: "Invalid Request: batches are not supported",
        },
      })
    return
  }
  next()
}

export function createGatewayApp(config: GatewayConfig): Express {
  const app = express()
  app.disable("x-powered-by")
  app.get([...METADATA_PATHS], (_req, res) =>
    res.json(protectedResourceMetadata(config)),
  )
  app.get("/mcp", (_req, res) =>
    res.status(405).setHeader("Allow", "POST").end(),
  )
  app.delete("/mcp", (_req, res) =>
    res.status(405).setHeader("Allow", "POST").end(),
  )
  app.post(
    "/mcp",
    createOriginGuard(config),
    express.json({ limit: "256kb" }),
    rejectBatch,
    async (req, res) => {
      const bearer = extractBearer(req.headers.authorization)
      if (!bearer) {
        sendChallenge(res, config)
        return
      }
    const api = createApiClient(config, bearer)
    const method =
      typeof req.body === "object" && req.body !== null
        ? (req.body as { method?: unknown }).method
        : undefined

    // `initialize` otherwise has no reason to touch the API. Probe the same
    // authenticated student endpoint that tools/list uses, so a JWT-shaped
    // but invalid/expired token gets the OAuth challenge before the client
    // considers the MCP session established.
    if (method === "initialize") {
      try {
        await api.get("/api/me")
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          sendChallenge(res, config)
          return
        }
      }
    }
      let challenge = false
      const server = buildMcpServer({
      api,
        onChallenge: () => {
          challenge = true
        },
      })
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      res.on("close", () => {
        void transport.close()
        void server.close()
      })
      await server.connect(transport)
      const response = await transport.handleRequest(
        toWebRequest(req, config),
        { parsedBody: req.body as unknown },
      )
      if (challenge) {
        sendChallenge(res, config)
        return
      }
      await sendWebResponse(res, response)
    },
  )
  app.use((error: unknown, _req: Request, res: Response, _next: unknown) => {
    if (res.headersSent) return
    const type = (error as { type?: unknown } | null)?.type
    if (type === "entity.parse.failed") {
      res
        .status(400)
        .json({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        })
      return
    }
    if (type === "entity.too.large") {
      res
        .status(413)
        .json({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid Request: body too large" },
        })
      return
    }
    res
      .status(500)
      .json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: "Internal error" },
      })
  })
  return app
}
