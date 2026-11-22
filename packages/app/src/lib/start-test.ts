import { defaultStringifySearch } from "@tanstack/react-router"
import type { AttemptStart, TestBrief } from "./api-types.js"
import { attemptGateway } from "./attempt/gateway-selector.js"
import type { StartHint } from "./attempt/attempt-gateway.js"
import { getTest } from "./catalog-api.js"

export function sectionRulesPath(
  attempt: AttemptStart,
  sectionId: string,
): string {
  const search = attempt.finalizedPriorAttempt
    ? defaultStringifySearch({
        finalizedPriorAttempt: attempt.finalizedPriorAttempt,
      })
    : ""

  return `/attempts/${attempt.id}/sections/${sectionId}/rules${search}`
}

export function firstSectionOf(
  brief: TestBrief,
): TestBrief["sections"][number] | undefined {
  return brief.sections.reduce<TestBrief["sections"][number] | undefined>(
    (first, section) =>
      !first || section.ordinal < first.ordinal ? section : first,
    undefined,
  )
}

/**
 * Offline the brief cannot be fetched (the worker never caches it), but an
 * attempt the gateway could start offline carries its own sections, in
 * order. Only a request that got no response at all (`TypeError`) counts.
 */
async function startWithoutBrief(
  slug: string,
  hint: StartHint,
): Promise<string> {
  const attempt = await attemptGateway.start(slug, hint)
  const envelope = await attemptGateway.loadEnvelope(attempt.id)
  const first = envelope.sections.at(0)

  if (!first) {
    throw new Error(`test ${slug} has no sections`)
  }

  return sectionRulesPath(attempt, first.id)
}

/**
 * Library "Start": brief (for the first section id) → start the attempt
 * through the attempt gateway → rules path. `hint` comes from the library
 * card (`inProgressAttemptId`).
 */
export async function startTestAndRulesPath(
  slug: string,
  hint: StartHint = { inProgressAttemptId: null },
): Promise<string> {
  const brief = await getTest(slug).catch((error: unknown) => {
    if (error instanceof TypeError) {
      return null
    }

    throw error
  })

  if (brief === null) {
    return startWithoutBrief(slug, hint)
  }

  const first = firstSectionOf(brief)

  if (!first) {
    throw new Error(`test ${slug} has no sections`)
  }

  const attempt = await attemptGateway.start(slug, hint)

  return sectionRulesPath(attempt, first.id)
}
