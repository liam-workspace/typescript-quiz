import { afterEach, describe, expect, it, vi } from "vitest"
import { apiFlushHttp } from "../src/lib/flushHttp.js"

describe("apiFlushHttp", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("maps a 200 response to an 'ok' result carrying the parsed results array", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ questionId: "q1", status: "applied" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await apiFlushHttp.patch("/attempts/a1/responses", {
      clientInstanceId: "device-1",
      responses: [],
    })

    expect(result).toEqual({
      kind: "ok",
      status: 200,
      body: { results: [{ questionId: "q1", status: "applied" }] },
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/attempts/a1/responses")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PATCH")
  })

  it("maps a non-2xx response to an 'http-error' result carrying the real status and the parsed problem body", async () => {
    const problem = {
      type: "section_expired",
      title: "The section's clock ran out.",
      status: 410,
      retryable: false,
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(problem), {
        status: 410,
        headers: { "content-type": "application/problem+json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await apiFlushHttp.patch("/attempts/a1/responses", {
      clientInstanceId: "device-1",
      responses: [],
    })

    expect(result).toEqual({
      kind: "http-error",
      status: 410,
      body: problem,
    })
  })

  it("maps a rejected fetch (offline, DNS, etc.) to a 'network-error' result", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"))
    vi.stubGlobal("fetch", fetchMock)

    const result = await apiFlushHttp.patch("/attempts/a1/responses", {
      clientInstanceId: "device-1",
      responses: [],
    })

    expect(result).toEqual({ kind: "network-error" })
  })

  it("maps an unparseable response body to a 'network-error' result rather than throwing", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await apiFlushHttp.patch("/attempts/a1/responses", {
      clientInstanceId: "device-1",
      responses: [],
    })

    expect(result).toEqual({ kind: "network-error" })
  })
})
