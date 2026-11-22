import type { RunnerEnvelope } from "../../src/lib/api-types.js"
import { toPendingSection } from "../../src/lib/attempt/local-sections.js"
import { makeBundle } from "./bundle-fixture.js"

/**
 * An attempt with 10 minutes left. `open` picks the section that is running:
 * the listening section starts on its first question, the reading section on
 * its only question (listening already closed).
 */
export function makeEnvelope(
  open: "listening" | "reading" = "listening",
): RunnerEnvelope {
  const bundle = makeBundle()
  const now = Date.now()
  const expiresAt = new Date(now + 600_000).toISOString()
  const openId = open === "listening" ? "sec-l" : "sec-r"
  const statusOf = (id: string): "open" | "closed" | "pending" => {
    if (id === openId) {
      return "open"
    }

    return open === "reading" && id === "sec-l" ? "closed" : "pending"
  }

  return {
    id: "att-1",
    status: "in_progress",
    attemptNumber: 1,
    testTitle: bundle.title,
    expiresAt,
    serverTime: new Date(now).toISOString(),
    questionCount: 3,
    answeredCount: 0,
    unansweredOrdinals: [1, 2, 3],
    offlineJournalCursor: 0,
    currentSectionId: openId,
    currentQuestionId: open === "listening" ? "q-l1" : "q-r1",
    sections: bundle.sections.map((section) => ({
      ...toPendingSection(section),
      status: statusOf(section.id),
      expiresAt: section.id === openId ? expiresAt : null,
    })),
    responses: [],
  }
}
