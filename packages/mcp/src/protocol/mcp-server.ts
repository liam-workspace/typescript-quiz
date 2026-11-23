import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { ApiError, type ApiClient } from "../api/client.js"

interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: Tool["inputSchema"]
  readonly annotations: Tool["annotations"]
}

const noArguments = z.object({}).strict()
const listArguments = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().optional(),
  })
  .strict()
const slugArguments = z.object({ slug: z.string().min(1) }).strict()
const attemptArguments = z.object({ attemptId: z.uuid() }).strict()

function objectSchema(
  properties: Record<string, object>,
  required: string[] = [],
): Tool["inputSchema"] {
  return { type: "object", properties, required, additionalProperties: false }
}

export const toolDefinitions: readonly ToolDefinition[] = [
  {
    name: "list_published_tests",
    description:
      "List published TOEFL Primary tests and this student's standing.",
    inputSchema: objectSchema({
      limit: { type: "integer", minimum: 1, maximum: 100 },
      cursor: { type: "string" },
    }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_test_details",
    description: "Get a published test's sections, instructions, and rules.",
    inputSchema: objectSchema({ slug: { type: "string" } }, ["slug"]),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "list_finished_attempts",
    description: "List this student's submitted or expired attempts.",
    inputSchema: objectSchema({
      limit: { type: "integer", minimum: 1, maximum: 100 },
      cursor: { type: "string" },
    }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_attempt_result",
    description: "Get the score breakdown for a completed attempt.",
    inputSchema: objectSchema(
      { attemptId: { type: "string", format: "uuid" } },
      ["attemptId"],
    ),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_attempt_review",
    description: "Get answers and the answer key for a completed attempt.",
    inputSchema: objectSchema(
      { attemptId: { type: "string", format: "uuid" } },
      ["attemptId"],
    ),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
]

export interface McpServerScope {
  readonly api: ApiClient
  onChallenge(): void
}

function textResult(value: unknown, isError = false) {
  const text = JSON.stringify(value)

  return {
    content: [
      {
        type: "text" as const,
        text: text.length > 500_000 ? "Tool result is too large." : text,
      },
    ],
    ...(isError || text.length > 500_000 ? { isError: true } : {}),
  }
}

function pathFor(name: string, arguments_: unknown): string {
  switch (name) {
    case "list_published_tests": {
      const args = listArguments.parse(arguments_)
      const query = new URLSearchParams({
        ...(args.limit ? { limit: String(args.limit) } : {}),
        ...(args.cursor ? { cursor: args.cursor } : {}),
      })

      return `/api/tests${query.size ? `?${query}` : ""}`
    }

    case "get_test_details":
      return `/api/tests/${encodeURIComponent(slugArguments.parse(arguments_).slug)}`

    case "list_finished_attempts": {
      const args = listArguments.parse(arguments_)
      const query = new URLSearchParams({
        status: "finished",
        ...(args.limit ? { limit: String(args.limit) } : {}),
        ...(args.cursor ? { cursor: args.cursor } : {}),
      })

      return `/api/attempts?${query}`
    }

    case "get_attempt_result":
      return `/api/attempts/${attemptArguments.parse(arguments_).attemptId}/result`

    case "get_attempt_review":
      return `/api/attempts/${attemptArguments.parse(arguments_).attemptId}/review`

    default:
      throw new McpError(ErrorCode.InvalidParams, "Unknown tool.")
  }
}

// The low-level Server is intentional: tools are registered through raw
// request handlers so every call can be scoped to the caller's API token.
// eslint-disable-next-line typescript/no-deprecated
export function buildMcpServer(scope: McpServerScope): Server {
  // eslint-disable-next-line typescript/no-deprecated
  const server = new Server(
    { name: "primary-practice", version: "1.0.0" },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      await scope.api.get("/api/me")

      return { tools: toolDefinitions }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        scope.onChallenge()
      }

      throw new McpError(ErrorCode.InternalError, "Could not load your tools.")
    }
  })
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return textResult(
        await scope.api.get(
          pathFor(request.params.name, request.params.arguments ?? {}),
        ),
      )
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        scope.onChallenge()

        return textResult("Re-authorization required.", true)
      }

      if (error instanceof z.ZodError) {
        return textResult("Invalid tool arguments.", true)
      }

      if (error instanceof McpError) {
        throw error
      }

      return textResult("The requested information is unavailable.", true)
    }
  })

  return server
}
