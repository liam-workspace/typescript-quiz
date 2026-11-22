import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AttemptStart, TestBrief } from "./api-types.js"
import { attemptGateway } from "./attempt/gateway-selector.js"
import { startAttempt } from "./attempts-api.js"
import { getTest } from "./catalog-api.js"
import { startTestAndRulesPath } from "./start-test.js"

vi.mock("./attempts-api.js", () => ({ startAttempt: vi.fn() }))
vi.mock("./catalog-api.js", () => ({ getTest: vi.fn() }))

const brief = {
  id: "t",
  slug: "practice-3",
  title: "Practice Test 3",
  level: "primary-step-1",
  durationSeconds: 1320,
  attemptCount: 0,
  inProgressAttemptId: null,
  sections: [
    { id: "s2", ordinal: 2, type: "reading", title: "Reading" },
    { id: "s1", ordinal: 1, type: "listening", title: "Listening" },
  ],
} as unknown as TestBrief
const attempt = {
  id: "a1",
  attemptNumber: 1,
  status: "in_progress",
  finalizedPriorAttempt: null,
} as unknown as AttemptStart

describe("startTestAndRulesPath", () => {
  beforeEach(() => {
    vi.mocked(getTest).mockReset()
    vi.mocked(startAttempt).mockReset()
  })

  it("starts the attempt and returns the rules path of the lowest-ordinal section", async () => {
    vi.mocked(getTest).mockResolvedValue(brief)
    vi.mocked(startAttempt).mockResolvedValue(attempt)

    await expect(startTestAndRulesPath("practice-3")).resolves.toBe(
      "/attempts/a1/sections/s1/rules",
    )
    expect(startAttempt).toHaveBeenCalledWith("practice-3")
  })

  it("starts through the attempt gateway with the card's hint", async () => {
    vi.mocked(getTest).mockResolvedValue(brief)
    const start = vi
      .spyOn(attemptGateway, "start")
      .mockResolvedValue({ ...attempt, id: "a9" })

    try {
      await expect(
        startTestAndRulesPath("practice-3", { inProgressAttemptId: "a9" }),
      ).resolves.toBe("/attempts/a9/sections/s1/rules")
      expect(start).toHaveBeenCalledWith("practice-3", {
        inProgressAttemptId: "a9",
      })
    } finally {
      start.mockRestore()
    }
  })

  it("carries a finalizedPriorAttempt notice in the search string", async () => {
    vi.mocked(getTest).mockResolvedValue(brief)
    vi.mocked(startAttempt).mockResolvedValue({
      ...attempt,
      finalizedPriorAttempt: {
        id: "old",
        status: "expired",
        submittedAt: "2026-11-01T10:00:00.000Z",
        resultUrl: "/attempts/old/result",
      },
    })

    const path = await startTestAndRulesPath("practice-3")

    expect(path.startsWith("/attempts/a1/sections/s1/rules?")).toBe(true)
    expect(path).toContain("finalizedPriorAttempt")
  })

  it("refuses a test with no sections without creating an attempt", async () => {
    vi.mocked(getTest).mockResolvedValue({ ...brief, sections: [] })

    await expect(startTestAndRulesPath("practice-3")).rejects.toThrow(
      "no sections",
    )
    expect(startAttempt).not.toHaveBeenCalled()
  })

  it("offline, the first section comes from the attempt itself (the brief endpoint is not cached)", async () => {
    vi.mocked(getTest).mockRejectedValue(new TypeError("Failed to fetch"))
    const start = vi
      .spyOn(attemptGateway, "start")
      .mockResolvedValue({ ...attempt, id: "local-1" })
    const load = vi.spyOn(attemptGateway, "loadEnvelope").mockResolvedValue({
      sections: [{ id: "s1" }, { id: "s2" }],
    } as unknown as Awaited<ReturnType<typeof attemptGateway.loadEnvelope>>)

    try {
      await expect(startTestAndRulesPath("practice-3")).resolves.toBe(
        "/attempts/local-1/sections/s1/rules",
      )
      expect(load).toHaveBeenCalledWith("local-1")
    } finally {
      start.mockRestore()
      load.mockRestore()
    }
  })

  it("a server refusal of the brief is not mistaken for being offline", async () => {
    vi.mocked(getTest).mockRejectedValue(new Error("test_not_found"))
    const start = vi.spyOn(attemptGateway, "start")

    try {
      await expect(startTestAndRulesPath("practice-3")).rejects.toThrow(
        "test_not_found",
      )
      expect(start).not.toHaveBeenCalled()
    } finally {
      start.mockRestore()
    }
  })
})
