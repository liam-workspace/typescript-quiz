import type { ChoiceId, QuestionId, SectionId } from "./domain/ids.js"
import type { Score, SectionScore } from "./domain/attempt.js"
import type { SectionType } from "./domain/test.js"
import type { ScoringChoice, ScoringQuestion } from "./scoring.js"

export interface GradableSection {
  id: SectionId
  title: string
  type: SectionType
}

/**
 * `ScoringQuestion` itself does not carry `sectionId` yet -- `loadForScoring`
 * (packages/db) projects it from `question`/`choice` alone, with no join
 * back to `question_group`/`test_section`. Plan 5's Task 4 is the one that
 * wires the section join through; until then this local intersection is the
 * honest input type for `gradeAttempt`, which cannot group by section
 * without it. Widening `ScoringQuestion` itself in `./scoring.js` is out of
 * this task's scope and would break the field's existing callers/tests, so
 * this type -- not a `scoring.ts` edit -- is the seam Task 4 fills in.
 */
export type GradableQuestion = ScoringQuestion & { sectionId: SectionId }

export interface GradableResponse {
  questionId: QuestionId
  selectedChoiceIds: ChoiceId[]
}

export type GradeResult = Omit<Score, "isPersonalBest">

/** True iff the selected set exactly equals the correct-choice set. No partial credit. */
export function isQuestionCorrect(
  question: ScoringQuestion,
  selectedChoiceIds: readonly ChoiceId[],
): boolean {
  const correct = new Set(
    question.choices.filter((c: ScoringChoice) => c.isCorrect).map((c) => c.id),
  )
  const selected = new Set(selectedChoiceIds)

  return (
    correct.size === selected.size &&
    [...correct].every((id) => selected.has(id))
  )
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100
}

interface SectionBucket {
  earned: number
  possible: number
}

export function gradeAttempt(input: {
  sections: GradableSection[]
  questions: GradableQuestion[]
  responses: GradableResponse[]
}): GradeResult {
  const responseByQuestion = new Map(
    input.responses.map((r) => [r.questionId, r.selectedChoiceIds]),
  )

  const perSection = new Map<SectionId, SectionBucket>()
  for (const section of input.sections) {
    perSection.set(section.id, { earned: 0, possible: 0 })
  }

  let pointsEarned = 0
  let pointsPossible = 0
  let answered = 0
  let correct = 0

  for (const question of input.questions) {
    const bucket = perSection.get(question.sectionId)

    if (!bucket) {
      // A question whose section is absent from `sections` is a caller bug
      // (frozen content and the section list disagreeing), not a grading
      // decision -- fail loudly rather than silently dropping points.
      throw new Error(
        `gradeAttempt: unknown sectionId for question ${question.id}`,
      )
    }

    pointsPossible += question.points
    bucket.possible += question.points

    const selected = responseByQuestion.get(question.id) ?? []

    if (selected.length === 0) {
      continue
    }

    answered += 1

    if (isQuestionCorrect(question, selected)) {
      correct += 1
      pointsEarned += question.points
      bucket.earned += question.points
    }
  }

  const sections: SectionScore[] = input.sections.map((section) => {
    const bucket = perSection.get(section.id)

    if (!bucket) {
      throw new Error(`gradeAttempt: unreachable -- bucket seeded above`)
    }

    return {
      title: section.title,
      type: section.type,
      pointsEarned: bucket.earned,
      pointsPossible: bucket.possible,
    }
  })

  return {
    pointsEarned,
    pointsPossible,
    percentage:
      pointsPossible === 0
        ? 0
        : roundToTwoDecimals((pointsEarned / pointsPossible) * 100),
    answered,
    unanswered: input.questions.length - answered,
    correct,
    incorrect: answered - correct,
    sections,
  }
}
