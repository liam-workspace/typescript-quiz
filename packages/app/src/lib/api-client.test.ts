import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError, apiFetch } from "./api-client.js"

describe("apiFetch", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("attaches the dev bearer token when one is configured", async () => {
    vi.stubEnv("VITE_DEV_BEARER_TOKEN", "dev-token")
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "student-1" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await apiFetch<{ id: string }>("/me")

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/me")
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization"),
    ).toBe("Bearer dev-token")
  })

  it("throws ApiError with the parsed problem+json body on a non-2xx response", async () => {
    const problem = {
      type: "attempt_expired",
      title: "Attempt expired",
      status: 410,
      detail: "The deadline has passed.",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(problem), {
          headers: { "content-type": "application/problem+json" },
          status: 410,
        }),
      ),
    )

    const thrown: unknown = await apiFetch("/attempts/attempt-1").catch(
      (error: unknown) => error,
    )

    expect(thrown).toBeInstanceOf(ApiError)
    expect(thrown).toMatchObject({ message: problem.type, problem })
  })

  it("returns undefined for a 204 with no body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 204 })),
    )

    const result = await apiFetch<undefined>("/session", { method: "POST" })

    expect(result).toBeUndefined()
  })

  it("defaults request bodies to JSON", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ created: true }), { status: 201 }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await apiFetch("/session", { body: "{}", method: "POST" })

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/session")
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe("{}")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST")
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("content-type"),
    ).toBe("application/json")
  })

  it("preserves caller Headers values", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ created: true }), { status: 201 }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await apiFetch("/session", {
      body: "{}",
      headers: new Headers({
        "content-type": "application/merge-patch+json",
        "x-request-id": "request-1",
      }),
      method: "POST",
    })

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get("content-type")).toBe("application/merge-patch+json")
    expect(headers.get("x-request-id")).toBe("request-1")
  })
})
