import { describe, expect, it } from "vitest"
import {
  contentBlockSchema,
  deriveDistractors,
  renderCanonicalLatex,
  testDocumentSchema,
  verifyMathProblem,
  type MathProblemSpec,
  type MathAnswer,
} from "../src/index.js"

const integer = (value: number) => ({ kind: "integer" as const, value })
const fraction = (numerator: number, denominator: number) => ({
  kind: "fraction" as const,
  numerator,
  denominator,
})
const answer = (numerator: number, denominator = 1): MathAnswer => ({
  kind: denominator === 1 ? "integer" : "rational",
  numerator,
  denominator,
})
const base = {
  seed: "seed-1",
  variables: {},
  constraints: { min: -100, max: 100, nonNegative: false },
}
const problems: MathProblemSpec[] = [
  {
    ...base,
    family: "fraction_addition",
    expression: { kind: "add", left: fraction(1, 2), right: fraction(1, 3) },
    answer: answer(5, 6),
  },
  {
    ...base,
    family: "percentage_of_quantity",
    expression: {
      kind: "multiply",
      left: fraction(25, 100),
      right: integer(80),
    },
    answer: answer(20),
  },
  {
    ...base,
    family: "ratio",
    expression: { kind: "divide", left: integer(6), right: integer(8) },
    answer: answer(3, 4),
  },
  {
    ...base,
    family: "linear_equation",
    expression: {
      kind: "equation",
      left: {
        kind: "add",
        left: {
          kind: "multiply",
          left: integer(2),
          right: { kind: "variable", name: "x" },
        },
        right: integer(3),
      },
      right: integer(11),
    },
    answer: answer(4),
  },
]

describe("math verification", () => {
  it.each(problems)("verifies $family", (spec) => {
    expect(verifyMathProblem(spec).valid).toBe(true)
    expect(verifyMathProblem({ ...spec, answer: answer(99) }).valid).toBe(false)
  })

  it("rejects nested powers before they can produce oversized integers", () => {
    let power: MathProblemSpec["expression"] = fraction(1, 2)
    for (let i = 0; i < 4; i += 1) {
      power = { kind: "power", left: power, right: integer(8) }
    }
    const spec: MathProblemSpec = {
      ...problems[3],
      expression: {
        kind: "equation",
        left: { kind: "variable", name: "x" },
        right: { kind: "subtract", left: power, right: power },
      },
      answer: answer(0),
    }
    expect(verifyMathProblem(spec)).toEqual({
      valid: false,
      errors: ["expression exceeds arithmetic limit"],
    })
  })

  it("enforces constraints on expression values and the answer without variable declarations", () => {
    const constraints = { min: 0, max: 10, nonNegative: true }
    expect(
      verifyMathProblem({
        ...problems[2],
        constraints,
        expression: { kind: "divide", left: integer(-6), right: integer(-8) },
      }).valid,
    ).toBe(false)
    expect(
      verifyMathProblem({
        ...problems[3],
        constraints,
        expression: {
          kind: "equation",
          left: { kind: "variable", name: "x" },
          right: integer(11),
        },
        answer: answer(11),
      }).valid,
    ).toBe(false)
    expect(
      verifyMathProblem({
        ...problems[3],
        constraints,
        expression: {
          kind: "equation",
          left: {
            kind: "divide",
            left: {
              kind: "multiply",
              left: { kind: "variable", name: "x" },
              right: integer(5),
            },
            right: integer(5),
          },
          right: integer(3),
        },
        answer: answer(3),
      }).valid,
    ).toBe(false)
    expect(
      verifyMathProblem({ ...problems[3], variables: { y: 2 } }).valid,
    ).toBe(false)
    expect(
      verifyMathProblem({ ...problems[3], variables: { x: 5 } }).valid,
    ).toBe(false)
  })

  it("rejects unknown content block fields", () => {
    expect(
      contentBlockSchema.safeParse({ kind: "text", value: "A", extra: true })
        .success,
    ).toBe(false)
    expect(
      contentBlockSchema.safeParse({
        kind: "math",
        tex: "x",
        display: false,
        extra: true,
      }).success,
    ).toBe(false)
  })

  it("rejects equivalent choices and incorrect correctness flags", () => {
    const [spec] = problems
    expect(
      verifyMathProblem({
        ...spec,
        choices: [
          { answer: answer(5, 6), isCorrect: true },
          { answer: answer(10, 12), isCorrect: false },
        ],
      }).valid,
    ).toBe(false)
    expect(
      verifyMathProblem({
        ...spec,
        choices: [
          { answer: answer(1, 6), isCorrect: true },
          { answer: answer(5, 6), isCorrect: false },
        ],
      }).valid,
    ).toBe(false)
  })

  it("rejects malformed answers and ambiguous equations", () => {
    expect(
      verifyMathProblem({ ...problems[0], answer: answer(1, 0) }).valid,
    ).toBe(false)
    expect(
      verifyMathProblem({
        ...problems[0],
        answer: { kind: "integer", numerator: 5, denominator: 6 },
      }).valid,
    ).toBe(false)
    expect(
      verifyMathProblem({
        ...problems[3],
        expression: {
          kind: "equation",
          left: { kind: "variable", name: "x" },
          right: { kind: "variable", name: "x" },
        },
      }).valid,
    ).toBe(false)
  })

  it("derives repeatable, distinct distractors that differ from the answer", () => {
    const distractors = deriveDistractors(problems[0])
    expect(distractors).toEqual(deriveDistractors(problems[0]))
    expect(distractors).toHaveLength(3)
    expect(
      verifyMathProblem({
        ...problems[0],
        choices: [
          { answer: problems[0].answer, isCorrect: true },
          ...distractors.map((value) => ({ answer: value, isCorrect: false })),
        ],
      }).valid,
    ).toBe(true)
  })

  it("enforces the full constraint range on generated and supplied choices", () => {
    const spec: MathProblemSpec = {
      ...problems[2],
      constraints: { min: -5, max: 1, nonNegative: true },
      expression: { kind: "divide", left: integer(0), right: integer(1) },
      answer: answer(0),
    }
    const distractors = deriveDistractors(spec)
    expect(distractors).toHaveLength(3)
    for (const choice of distractors) {
      expect(choice.numerator).toBeGreaterThan(0)
      expect(choice.numerator).toBeLessThanOrEqual(choice.denominator)
    }
    const choices = [
      { answer: spec.answer, isCorrect: true },
      ...distractors.map((value) => ({ answer: value, isCorrect: false })),
    ]
    expect(verifyMathProblem({ ...spec, choices }).valid).toBe(true)
    for (const value of [answer(-1, 2), answer(3, 2)]) {
      expect(
        verifyMathProblem({
          ...spec,
          choices: [...choices, { answer: value, isCorrect: false }],
        }).errors,
      ).toEqual(["value outside constraints"])
    }
  })

  it("derives three distinct representable choices at the safe integer limit", () => {
    const max = Number.MAX_SAFE_INTEGER
    const spec: MathProblemSpec = {
      ...problems[3],
      constraints: { min: max - 3, max, nonNegative: true },
      expression: {
        kind: "equation",
        left: { kind: "variable", name: "x" },
        right: integer(max),
      },
      answer: answer(max),
    }
    const distractors = deriveDistractors(spec)
    expect(distractors).toEqual(deriveDistractors(spec))
    expect(distractors).toHaveLength(3)
    expect(distractors).toEqual(
      expect.arrayContaining([
        answer(max - 1),
        answer(max - 2),
        answer(max - 3),
      ]),
    )
  })

  it("rejects non-string variable names before coercion", () => {
    for (const name of [["x"], { toString: () => "x" }]) {
      const variable = {
        kind: "variable" as const,
        name: name as unknown as string,
      }
      expect(
        verifyMathProblem({
          ...problems[3],
          expression: { kind: "equation", left: variable, right: integer(4) },
        }).errors,
      ).toEqual(["invalid variable name"])
      expect(() => renderCanonicalLatex(variable)).toThrow(
        "invalid variable name",
      )
    }
  })

  it("reports when the range has fewer than three representable alternatives", () => {
    const max = Number.MAX_SAFE_INTEGER
    const spec: MathProblemSpec = {
      ...problems[3],
      constraints: { min: max - 1, max, nonNegative: true },
      expression: {
        kind: "equation",
        left: { kind: "variable", name: "x" },
        right: integer(max),
      },
      answer: answer(max),
    }
    expect(() => deriveDistractors(spec)).toThrow(
      "constraints allow fewer than three representable distractors",
    )
  })

  it("renders canonical latex from the AST", () => {
    expect(renderCanonicalLatex(problems[0].expression)).toBe(
      "\\frac{1}{2} + \\frac{1}{3}",
    )
  })

  it("preserves grouping in nested subtraction", () => {
    expect(
      renderCanonicalLatex({
        kind: "subtract",
        left: integer(5),
        right: { kind: "add", left: integer(2), right: integer(1) },
      }),
    ).toBe("5 - \\left(2 + 1\\right)")
  })

  it("accepts blocks alongside required legacy strings", () => {
    const doc = {
      title: "Test",
      slug: "test",
      durationSeconds: 60,
      sections: [
        {
          title: "S",
          type: "reading",
          durationSeconds: 60,
          navigation: "free",
          allowAnswerChange: true,
          playback: null,
          groups: [
            {
              questions: [
                {
                  questionKey: "q",
                  prompt: "Prompt",
                  promptBlocks: [{ kind: "math", tex: "x", display: false }],
                  type: "single_choice",
                  points: 1,
                  choices: [
                    {
                      label: "A",
                      labelBlocks: [{ kind: "text", value: "A" }],
                      isCorrect: true,
                    },
                    { label: "B", isCorrect: false },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const parsed = testDocumentSchema.parse(doc)
    expect(parsed.sections[0].groups[0].questions[0].promptBlocks).toEqual([
      { kind: "math", tex: "x", display: false },
    ])
    expect(
      parsed.sections[0].groups[0].questions[0].choices[0].labelBlocks,
    ).toEqual([{ kind: "text", value: "A" }])
    expect(
      testDocumentSchema.safeParse({
        ...doc,
        sections: [
          {
            ...doc.sections[0],
            groups: [
              {
                questions: [
                  {
                    ...doc.sections[0].groups[0].questions[0],
                    prompt: undefined,
                  },
                ],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false)
  })
})
