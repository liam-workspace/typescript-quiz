import type { ChoiceId, QuestionId } from "./domain/ids.js"
import type { RunnerChoice, RunnerQuestion } from "./domain/test.js"

/** Used only by the scoring service. Never serialized to a student. */
export interface ScoringChoice extends RunnerChoice {
  isCorrect: boolean
}

export interface ScoringQuestion extends Omit<RunnerQuestion, "choices"> {
  points: number
  choices: ScoringChoice[]
}

export interface RecordedAnswer {
  questionId: QuestionId
  selectedChoiceIds: ChoiceId[]
}

export interface AttemptScoreSummary {
  pointsEarned: number
  pointsPossible: number
  percentage: number
  answeredCount: number
  unansweredCount: number
  correctCount: number
  incorrectCount: number
  questionCount: number
}

/**
 * Pure. A question is correct when the selected set equals the correct
 * set exactly — single_choice's "exactly one correct" and multi_choice's
 * "all of them, none extra" are the same rule once expressed as set
 * equality, so there is one comparison, not two branches by type.
 */
export function scoreAttempt(
  questions: ScoringQuestion[],
  answers: RecordedAnswer[],
): AttemptScoreSummary {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]))
  let pointsEarned = 0
  let pointsPossible = 0
  let correctCount = 0
  let incorrectCount = 0
  let answeredCount = 0

  for (const question of questions) {
    pointsPossible += question.points
    const answer = byQuestion.get(question.id)

    if (!answer || answer.selectedChoiceIds.length === 0) {
      continue
    }

    answeredCount += 1
    const correctIds = new Set(
      question.choices.filter((c) => c.isCorrect).map((c) => c.id),
    )
    const selectedIds = new Set(answer.selectedChoiceIds)
    const isCorrect =
      correctIds.size === selectedIds.size &&
      [...correctIds].every((id) => selectedIds.has(id))

    if (isCorrect) {
      correctCount += 1
      pointsEarned += question.points
    } else {
      incorrectCount += 1
    }
  }

  return {
    pointsEarned,
    pointsPossible,
    percentage:
      pointsPossible === 0
        ? 0
        : Math.round((pointsEarned / pointsPossible) * 10000) / 100,
    answeredCount,
    unansweredCount: questions.length - answeredCount,
    correctCount,
    incorrectCount,
    questionCount: questions.length,
  }
}
