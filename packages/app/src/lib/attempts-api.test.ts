import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "./api-client.js"
import {
  claimPlay,
  enterSection,
  finishSection,
  getAttemptResult,
  getRunnerEnvelope,
  setPosition,
  startAttempt,
} from "./attempts-api.js"

describe("attempts-api", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("startAttempt calls POST /api/attempts with the test slug and returns the authoritative attempt", async () => {
    const attempt = {
      id: "attempt-1",
      attemptNumber: 2,
      status: "in_progress",
      createdAt: "2026-08-28T09:00:00.000Z",
      startedAt: null,
      expiresAt: null,
      serverTime: "2026-08-28T09:00:00.100Z",
      resumed: false,
      currentSectionId: null,
      currentQuestionId: null,
      finalizedPriorAttempt: {
        id: "attempt-stale",
        status: "expired",
        submittedAt: "2026-08-28T08:50:00.000Z",
        resultUrl: "/attempts/attempt-stale/result",
      },
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(attempt), {
        headers: { "content-type": "application/json" },
        status: 201,
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await startAttempt("primary-practice-04")

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/attempts")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST")
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ slug: "primary-practice-04" }),
    )
    expect(result).toEqual(attempt)
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

  it("getAttemptResult calls GET /api/attempts/:id/result and returns the parsed body", async () => {
    const attemptResult = {
      attemptId: "attempt-1",
      status: "submitted",
      score: { percentage: 90 },
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(attemptResult), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await getAttemptResult("attempt-1")

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/attempts/attempt-1/result")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()
    expect(result).toEqual(attemptResult)
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

  it("finishSection calls POST /api/attempts/:id/sections/:sectionId/finish with the queue remainder", async () => {
    const finished = {
      sectionId: "section-1",
      status: "finished" as const,
      nextSectionId: "section-2",
      finalFlush: [{ questionId: "question-1", status: "applied" as const }],
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(finished), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const body = {
      clientInstanceId: "device-1",
      responses: [
        {
          questionId: "question-1",
          seq: 9,
          selectedChoiceIds: ["choice-1"],
          answeredAt: "2026-08-28T09:10:00.000Z",
        },
      ],
    }

    const result = await finishSection("attempt-1", "section-1", body)

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/attempts/attempt-1/sections/section-1/finish",
    )
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST")
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(body))
    expect(result).toEqual(finished)
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
