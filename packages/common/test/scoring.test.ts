import { asChoiceId, asQuestionId } from "../src/domain/ids.js"
import {
  scoreAttempt,
  type RecordedAnswer,
  type ScoringChoice,
  type ScoringQuestion,
} from "../src/scoring.js"
import { describe, expect, it } from "vitest"

/**
 * `single_choice`'s "exactly one correct" and `multi_choice`'s "all of them,
 * none extra" are exercised as the same set-equality rule throughout this
 * file — see the doc comment on `scoreAttempt` — so most cases below use
 * `multi_choice` questions, which is the harder case to get right.
 */
function question(input: {
  id: string
  points: number
  choices: Array<{ id: string; isCorrect: boolean }>
}): ScoringQuestion {
  const choices: ScoringChoice[] = input.choices.map((c) => ({
    id: asChoiceId(c.id),
    label: c.id,
    isCorrect: c.isCorrect,
  }))

  return {
    id: asQuestionId(input.id),
    ordinal: 1,
    type: "multi_choice",
    prompt: "prompt",
    points: input.points,
    choices,
  }
}

function answer(
  questionId: string,
  selectedChoiceIds: string[],
): RecordedAnswer {
  return {
    questionId: asQuestionId(questionId),
    selectedChoiceIds: selectedChoiceIds.map(asChoiceId),
  }
}

describe("scoreAttempt", () => {
  it("awards points when the selected set exactly matches the correct set", () => {
    const q = question({
      id: "q1",
      points: 2,
      choices: [
        { id: "a", isCorrect: true },
        { id: "b", isCorrect: true },
        { id: "c", isCorrect: false },
      ],
    })

    const summary = scoreAttempt([q], [answer("q1", ["a", "b"])])

    expect(summary.pointsEarned).toBe(2)
    expect(summary.correctCount).toBe(1)
    expect(summary.incorrectCount).toBe(0)
  })

  it("awards nothing for a partial multi_choice selection", () => {
    const q = question({
      id: "q1",
      points: 3,
      choices: [
        { id: "a", isCorrect: true },
        { id: "b", isCorrect: true },
        { id: "c", isCorrect: true },
      ],
    })

    // 2 of 3 correct choices selected -- not the full correct set.
    const summary = scoreAttempt([q], [answer("q1", ["a", "b"])])

    expect(summary.pointsEarned).toBe(0)
    expect(summary.correctCount).toBe(0)
    expect(summary.incorrectCount).toBe(1)
  })

  it("awards nothing for a selection with one extra wrong choice", () => {
    const q = question({
      id: "q1",
      points: 3,
      choices: [
        { id: "a", isCorrect: true },
        { id: "b", isCorrect: true },
        { id: "c", isCorrect: false },
      ],
    })

    const summary = scoreAttempt([q], [answer("q1", ["a", "b", "c"])])

    expect(summary.pointsEarned).toBe(0)
    expect(summary.correctCount).toBe(0)
    expect(summary.incorrectCount).toBe(1)
  })

  it("counts a question with no recorded answer as unanswered, not incorrect", () => {
    const q = question({
      id: "q1",
      points: 1,
      choices: [
        { id: "a", isCorrect: true },
        { id: "b", isCorrect: false },
      ],
    })

    const summary = scoreAttempt([q], [])

    expect(summary.unansweredCount).toBe(1)
    expect(summary.incorrectCount).toBe(0)
    expect(summary.answeredCount).toBe(0)
  })

  it("sums pointsPossible from every question regardless of answer state", () => {
    const q1 = question({
      id: "q1",
      points: 2,
      choices: [
        { id: "a", isCorrect: true },
        { id: "b", isCorrect: false },
      ],
    })
    const q2 = question({
      id: "q2",
      points: 5,
      choices: [
        { id: "c", isCorrect: true },
        { id: "d", isCorrect: false },
      ],
    })

    // Only q1 answered; q2 left blank.
    const summary = scoreAttempt([q1, q2], [answer("q1", ["a"])])

    expect(summary.pointsPossible).toBe(7)
  })

  it("computes percentage as pointsEarned / pointsPossible * 100, rounded to 2 places", () => {
    const q1 = question({
      id: "q1",
      points: 1,
      choices: [
        { id: "a", isCorrect: true },
        { id: "b", isCorrect: false },
      ],
    })
    const q2 = question({
      id: "q2",
      points: 1,
      choices: [
        { id: "c", isCorrect: true },
        { id: "d", isCorrect: false },
      ],
    })
    const q3 = question({
      id: "q3",
      points: 1,
      choices: [
        { id: "e", isCorrect: true },
        { id: "f", isCorrect: false },
      ],
    })

    // 1 of 3 points earned -> 33.333...% rounded to 2 places.
    const summary = scoreAttempt(
      [q1, q2, q3],
      [answer("q1", ["a"]), answer("q2", ["d"]), answer("q3", ["f"])],
    )

    expect(summary.pointsEarned).toBe(1)
    expect(summary.pointsPossible).toBe(3)
    expect(summary.percentage).toBe(33.33)
  })

  it("returns all-zero-but-questionCount for zero recorded answers", () => {
    const q1 = question({
      id: "q1",
      points: 1,
      choices: [
        { id: "a", isCorrect: true },
        { id: "b", isCorrect: false },
      ],
    })
    const q2 = question({
      id: "q2",
      points: 1,
      choices: [
        { id: "c", isCorrect: true },
        { id: "d", isCorrect: false },
      ],
    })

    const summary = scoreAttempt([q1, q2], [])

    expect(summary).toEqual({
      pointsEarned: 0,
      pointsPossible: 2,
      percentage: 0,
      answeredCount: 0,
      unansweredCount: 2,
      correctCount: 0,
      incorrectCount: 0,
      questionCount: 2,
    })
  })
})
