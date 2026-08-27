import { asChoiceId, asQuestionId, asSectionId } from "../src/domain/ids.js"
import {
  gradeAttempt,
  isQuestionCorrect,
  type GradableResponse,
  type GradableSection,
} from "../src/grading.js"
import type { ScoringChoice, ScoringQuestion } from "../src/scoring.js"
import { describe, expect, it } from "vitest"

const SECTION_A = asSectionId("section-a")
const SECTION_B = asSectionId("section-b")

function section(input: {
  id: ReturnType<typeof asSectionId>
  title: string
  type: GradableSection["type"]
}): GradableSection {
  return { id: input.id, title: input.title, type: input.type }
}

function question(input: {
  id: string
  sectionId: ReturnType<typeof asSectionId>
  points: number
  type?: "single_choice" | "multi_choice"
  choices: Array<{ id: string; isCorrect: boolean }>
}): ScoringQuestion {
  const choices: ScoringChoice[] = input.choices.map((c) => ({
    id: asChoiceId(c.id),
    label: c.id,
    isCorrect: c.isCorrect,
  }))

  return {
    id: asQuestionId(input.id),
    sectionId: input.sectionId,
    ordinal: 1,
    type: input.type ?? "single_choice",
    prompt: "prompt",
    points: input.points,
    choices,
  }
}

function response(
  questionId: string,
  selectedChoiceIds: string[],
): GradableResponse {
  return {
    questionId: asQuestionId(questionId),
    selectedChoiceIds: selectedChoiceIds.map(asChoiceId),
  }
}

describe("isQuestionCorrect", () => {
  it("is true for an exact single_choice match", () => {
    const q = question({
      id: "q1",
      sectionId: SECTION_A,
      points: 1,
      type: "single_choice",
      choices: [
        { id: "a", isCorrect: true },
        { id: "b", isCorrect: false },
      ],
    })

    expect(isQuestionCorrect(q, [asChoiceId("a")])).toBe(true)
  })
})

describe("gradeAttempt", () => {
  it("awards full points for an exact single_choice match", () => {
    const sections = [section({ id: SECTION_A, title: "A", type: "reading" })]
    const q = question({
      id: "q1",
      sectionId: SECTION_A,
      points: 2,
      type: "single_choice",
      choices: [
        { id: "a", isCorrect: true },
        { id: "b", isCorrect: false },
      ],
    })

    const result = gradeAttempt({
      sections,
      questions: [q],
      responses: [response("q1", ["a"])],
    })

    expect(result.pointsEarned).toBe(2)
    expect(result.pointsPossible).toBe(2)
    expect(result.correct).toBe(1)
    expect(result.incorrect).toBe(0)
    expect(result.answered).toBe(1)
    expect(result.unanswered).toBe(0)
  })

  it("awards zero for a wrong single_choice selection", () => {
    const sections = [section({ id: SECTION_A, title: "A", type: "reading" })]
    const q = question({
      id: "q1",
      sectionId: SECTION_A,
      points: 2,
      type: "single_choice",
      choices: [
        { id: "a", isCorrect: true },
        { id: "b", isCorrect: false },
      ],
    })

    const result = gradeAttempt({
      sections,
      questions: [q],
      responses: [response("q1", ["b"])],
    })

    expect(result.pointsEarned).toBe(0)
    expect(result.correct).toBe(0)
    expect(result.incorrect).toBe(1)
    expect(result.answered).toBe(1)
  })

  it("treats an unanswered question as unanswered, not incorrect, and awards zero", () => {
    const sections = [section({ id: SECTION_A, title: "A", type: "reading" })]
    const q = question({
      id: "q1",
      sectionId: SECTION_A,
      points: 2,
      choices: [
        { id: "a", isCorrect: true },
        { id: "b", isCorrect: false },
      ],
    })

    const result = gradeAttempt({
      sections,
      questions: [q],
      responses: [],
    })

    expect(result.pointsEarned).toBe(0)
    expect(result.pointsPossible).toBe(2)
    expect(result.correct).toBe(0)
    expect(result.incorrect).toBe(0)
    expect(result.answered).toBe(0)
    expect(result.unanswered).toBe(1)
  })

  it("awards full points for a multi_choice selection matching ALL correct choices", () => {
    const sections = [section({ id: SECTION_A, title: "A", type: "reading" })]
    const q = question({
      id: "q1",
      sectionId: SECTION_A,
      points: 3,
      type: "multi_choice",
      choices: [
        { id: "a", isCorrect: true },
        { id: "b", isCorrect: true },
        { id: "c", isCorrect: false },
      ],
    })

    const result = gradeAttempt({
      sections,
      questions: [q],
      responses: [response("q1", ["a", "b"])],
    })

    expect(result.pointsEarned).toBe(3)
    expect(result.correct).toBe(1)
  })

  it("awards ZERO -- not partial credit -- for a multi_choice selection missing one correct choice", () => {
    const sections = [section({ id: SECTION_A, title: "A", type: "reading" })]
    const q = question({
      id: "q1",
      sectionId: SECTION_A,
      points: 3,
      type: "multi_choice",
      choices: [
        { id: "a", isCorrect: true },
        { id: "b", isCorrect: true },
        { id: "c", isCorrect: true },
      ],
    })

    const result = gradeAttempt({
      sections,
      questions: [q],
      responses: [response("q1", ["a", "b"])],
    })

    expect(result.pointsEarned).toBe(0)
    expect(result.correct).toBe(0)
    expect(result.incorrect).toBe(1)
  })

  it("awards zero for a multi_choice selection with an extra, incorrect choice included", () => {
    const sections = [section({ id: SECTION_A, title: "A", type: "reading" })]
    const q = question({
      id: "q1",
      sectionId: SECTION_A,
      points: 3,
      type: "multi_choice",
      choices: [
        { id: "a", isCorrect: true },
        { id: "b", isCorrect: true },
        { id: "c", isCorrect: false },
      ],
    })

    const result = gradeAttempt({
      sections,
      questions: [q],
      responses: [response("q1", ["a", "b", "c"])],
    })

    expect(result.pointsEarned).toBe(0)
    expect(result.correct).toBe(0)
    expect(result.incorrect).toBe(1)
  })

  it("sums points per section by the question's sectionId, not by ordinal ranges", () => {
    const sections = [
      section({ id: SECTION_A, title: "A", type: "reading" }),
      section({ id: SECTION_B, title: "B", type: "listening" }),
    ]

    // Interleaved by ordinal/array position: A, B, A, B -- a range-based
    // grouping (e.g. "first half is section A") would misattribute these.
    const questions = [
      question({
        id: "a1",
        sectionId: SECTION_A,
        points: 1,
        choices: [
          { id: "a1-x", isCorrect: true },
          { id: "a1-y", isCorrect: false },
        ],
      }),
      question({
        id: "b1",
        sectionId: SECTION_B,
        points: 5,
        choices: [
          { id: "b1-x", isCorrect: true },
          { id: "b1-y", isCorrect: false },
        ],
      }),
      question({
        id: "a2",
        sectionId: SECTION_A,
        points: 2,
        choices: [
          { id: "a2-x", isCorrect: true },
          { id: "a2-y", isCorrect: false },
        ],
      }),
      question({
        id: "b2",
        sectionId: SECTION_B,
        points: 10,
        choices: [
          { id: "b2-x", isCorrect: true },
          { id: "b2-y", isCorrect: false },
        ],
      }),
    ]

    const result = gradeAttempt({
      sections,
      questions,
      responses: [
        response("a1", ["a1-x"]),
        response("b1", ["b1-x"]),
        response("a2", ["a2-x"]),
        // Wrong -- section B loses these 10 points.
        response("b2", ["b2-y"]),
      ],
    })

    const sectionA = result.sections.find((s) => s.title === "A")
    const sectionB = result.sections.find((s) => s.title === "B")

    expect(sectionA).toEqual({
      title: "A",
      type: "reading",
      pointsEarned: 3,
      pointsPossible: 3,
    })
    expect(sectionB).toEqual({
      title: "B",
      type: "listening",
      pointsEarned: 5,
      pointsPossible: 15,
    })
    expect(result.pointsEarned).toBe(8)
    expect(result.pointsPossible).toBe(18)
  })

  it("rounds percentage to two decimal places, matching numeric(5,2)", () => {
    const sections = [section({ id: SECTION_A, title: "A", type: "reading" })]
    const questions = [
      question({
        id: "q1",
        sectionId: SECTION_A,
        points: 1,
        choices: [
          { id: "a", isCorrect: true },
          { id: "b", isCorrect: false },
        ],
      }),
      question({
        id: "q2",
        sectionId: SECTION_A,
        points: 1,
        choices: [
          { id: "c", isCorrect: true },
          { id: "d", isCorrect: false },
        ],
      }),
      question({
        id: "q3",
        sectionId: SECTION_A,
        points: 1,
        choices: [
          { id: "e", isCorrect: true },
          { id: "f", isCorrect: false },
        ],
      }),
    ]

    const result = gradeAttempt({
      sections,
      questions,
      responses: [
        response("q1", ["a"]),
        response("q2", ["d"]),
        response("q3", ["f"]),
      ],
    })

    expect(result.pointsEarned).toBe(1)
    expect(result.pointsPossible).toBe(3)
    expect(result.percentage).toBe(33.33)
  })

  it("returns percentage 0 rather than NaN when pointsPossible is 0", () => {
    const sections = [section({ id: SECTION_A, title: "A", type: "reading" })]

    const result = gradeAttempt({
      sections,
      questions: [],
      responses: [],
    })

    expect(result.pointsPossible).toBe(0)
    expect(result.percentage).toBe(0)
    expect(Number.isNaN(result.percentage)).toBe(false)
  })

  it("reconciles counts: correct + incorrect === answered, answered + unanswered === question_count", () => {
    const sections = [section({ id: SECTION_A, title: "A", type: "reading" })]
    const questions = [
      question({
        id: "q1",
        sectionId: SECTION_A,
        points: 1,
        choices: [
          { id: "a", isCorrect: true },
          { id: "b", isCorrect: false },
        ],
      }),
      question({
        id: "q2",
        sectionId: SECTION_A,
        points: 1,
        choices: [
          { id: "c", isCorrect: true },
          { id: "d", isCorrect: false },
        ],
      }),
      question({
        id: "q3",
        sectionId: SECTION_A,
        points: 1,
        choices: [
          { id: "e", isCorrect: true },
          { id: "f", isCorrect: false },
        ],
      }),
    ]

    const result = gradeAttempt({
      sections,
      questions,
      // Q1 correct, q2 wrong, q3 left blank.
      responses: [response("q1", ["a"]), response("q2", ["d"])],
    })

    expect(result.correct + result.incorrect).toBe(result.answered)
    expect(result.answered + result.unanswered).toBe(questions.length)
  })
})
