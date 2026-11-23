import { describe, expect, it, vi } from "vitest"
import { createApiClient } from "../api/client.js"
import { buildMcpServer, toolDefinitions } from "./mcp-server.js"

describe("MCP read tools", () => {
  it("defines only the five safe student read tools", () => {
    expect(toolDefinitions.map((tool) => tool.name)).toEqual([
      "list_published_tests",
      "get_test_details",
      "list_finished_attempts",
      "get_attempt_result",
      "get_attempt_review",
    ])
    expect(
      toolDefinitions.every((tool) => tool.annotations?.readOnlyHint),
    ).toBe(true)
  })

  it("forwards a bearer only to an allowlisted API path", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ tests: [] }), { status: 200 }),
      )
    const api = createApiClient(
      { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 1000 },
      "header.payload.signature",
      fetchFn,
    )

    await api.get("/api/tests?limit=10")

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.example.test/api/tests?limit=10",
      expect.objectContaining({
        headers: { Authorization: "Bearer header.payload.signature" },
      }),
    )
    await expect(api.get("https://evil.example.test/")).rejects.toThrow(
      "not allowlisted",
    )
  })

  it("builds a server without accepting generic API access", () => {
    const server = buildMcpServer({
      api: { get: vi.fn() },
      onChallenge: vi.fn(),
    })
    expect(server).toBeDefined()
  })
})
