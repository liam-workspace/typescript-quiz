import type { SectionId } from "./domain/ids.js"
import type { RunnerChoice, RunnerQuestion } from "./domain/test.js"

/**
 * The answer key's types, and only those.
 *
 * This module is a FENCE, not a utility shelf: it is reachable as
 * `@pp/common/scoring` and deliberately absent from the package's default
 * barrel, so a student-facing route cannot import `isCorrect` by accident.
 * `packages/db/test/boundary.test.ts` asserts that in both directions.
 *
 * It once also held `scoreAttempt`, a whole-attempt scorer that
 * `gradeAttempt` (./grading.js) superseded by doing the same work plus the
 * per-section breakdown the result screen needs. It kept a nine-case test
 * suite and zero production callers -- coverage that proved nothing about
 * shipped behaviour, and a second scoring implementation sitting one import
 * away from being wired in by mistake. Removed rather than documented,
 * because the honest fix for dead code is deletion.
 */

/** Used only by the scoring service. Never serialized to a student. */
export interface ScoringChoice extends RunnerChoice {
  isCorrect: boolean
}

export interface ScoringQuestion extends Omit<RunnerQuestion, "choices"> {
  sectionId: SectionId
  points: number
  choices: ScoringChoice[]
}
