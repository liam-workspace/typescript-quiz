import { defaultStringifySearch } from "@tanstack/react-router"
import type { AttemptStart, TestBrief } from "./api-types.js"
import { startAttempt } from "./attempts-api.js"
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

/** Library "Start": brief (for the first section id) → POST /attempts → rules path. */
export async function startTestAndRulesPath(slug: string): Promise<string> {
  const brief = await getTest(slug)
  const first = firstSectionOf(brief)

  if (!first) {
    throw new Error(`test ${slug} has no sections`)
  }

  const attempt = await startAttempt(slug)

  return sectionRulesPath(attempt, first.id)
}
