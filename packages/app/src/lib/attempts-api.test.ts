import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "./api-client.js"
import {
  claimPlay,
  enterSection,
  getRunnerEnvelope,
  setPosition,
} from "./attempts-api.js"

describe("attempts-api", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("getRunnerEnvelope calls GET /api/attempts/:id and returns the parsed body", async () => {
    const envelope = { id: "attempt-1", status: "in_progress" }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(envelope), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await getRunnerEnvelope("attempt-1")

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/attempts/attempt-1")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()
    expect(result).toEqual(envelope)
  })

  it("enterSection calls POST /api/attempts/:id/sections/:sectionId/enter", async () => {
    const entry = { sectionId: "section-1" }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(entry), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await enterSection("attempt-1", "section-1")

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/attempts/attempt-1/sections/section-1/enter",
    )
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST")
    expect(result).toEqual(entry)
  })

  it("claimPlay calls POST /api/attempts/:id/stimuli/:stimulusId/play", async () => {
    const grant = { stimulusId: "stim-1" }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(grant), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await claimPlay("attempt-1", "stim-1")

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/attempts/attempt-1/stimuli/stim-1/play",
    )
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST")
    expect(result).toEqual(grant)
  })

  it("setPosition calls PUT /api/attempts/:id/position with the JSON body {sectionId, questionId}", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await setPosition("attempt-1", "section-1", "question-1")

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/attempts/attempt-1/position",
    )
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT")
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ sectionId: "section-1", questionId: "question-1" }),
    )
    expect(result).toBeUndefined()
  })

  it("propagates ApiError from apiFetch on a non-2xx response", async () => {
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

    const thrown: unknown = await getRunnerEnvelope("attempt-1").catch(
      (error: unknown) => error,
    )

    expect(thrown).toBeInstanceOf(ApiError)
    expect(thrown).toMatchObject({ message: problem.type, problem })
  })
})
