// Runtime guards also protect callers passing untyped JSON.
/* oxlint-disable typescript/no-unnecessary-condition */
/** The supported mathematical syntax; no LaTeX is evaluated. */
export type MathAst =
  | { kind: "integer"; value: number }
  | { kind: "fraction"; numerator: number; denominator: number }
  | { kind: "variable"; name: string }
  | {
      kind: "add" | "subtract" | "multiply" | "divide" | "power" | "equation"
      left: MathAst
      right: MathAst
    }

export interface MathAnswer {
  kind: "integer" | "rational"
  numerator: number
  denominator: number
}

export interface MathProblemSpec {
  family:
    | "fraction_addition"
    | "percentage_of_quantity"
    | "ratio"
    | "linear_equation"
  seed: string
  variables: Record<string, number>
  expression: MathAst
  answer: MathAnswer
  constraints: { min: number; max: number; nonNegative: boolean }
  choices?: Array<{ answer: MathAnswer; isCorrect: boolean }>
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

interface Rational {
  n: bigint
  d: bigint
}
interface Linear {
  coefficient: Rational
  constant: Rational
}
const zero = { n: 0n, d: 1n }
const one = { n: 1n, d: 1n }
const maxBits = 512
const maxNodes = 256
function bitLength(value: bigint): number {
  return (value < 0n ? -value : value).toString(2).length
}
function rational(numerator: bigint, denominator: bigint): Rational {
  if (bitLength(numerator) > maxBits || bitLength(denominator) > maxBits) {
    throw new Error("expression exceeds arithmetic limit")
  }

  let n = numerator
  let d = denominator

  if (d === 0n) {
    throw new Error("division by zero")
  }

  if (d < 0n) {
    n = -n
    d = -d
  }

  let a = n < 0n ? -n : n
  let b = d

  while (b !== 0n) {
    const remainder = a % b
    a = b
    b = remainder
  }

  return { n: n / a, d: d / a }
}
function numberInteger(n: number): bigint {
  if (!Number.isSafeInteger(n)) {
    throw new Error("expected a safe integer")
  }

  return BigInt(n)
}
const add = (a: Rational, b: Rational) =>
  rational(a.n * b.d + b.n * a.d, a.d * b.d)
const neg = (a: Rational) => ({ n: -a.n, d: a.d })
const mul = (a: Rational, b: Rational) => rational(a.n * b.n, a.d * b.d)
const div = (a: Rational, b: Rational) => rational(a.n * b.d, a.d * b.n)
const equal = (a: Rational, b: Rational) => a.n === b.n && a.d === b.d
function answerValue(answer: MathAnswer): Rational {
  if (!answer || (answer.kind !== "integer" && answer.kind !== "rational")) {
    throw new Error("invalid answer kind")
  }

  const value = rational(
    numberInteger(answer.numerator),
    numberInteger(answer.denominator),
  )

  if (answer.kind === "integer" && value.d !== 1n) {
    throw new Error("integer answer must be integral")
  }

  return value
}
type Constraints = MathProblemSpec["constraints"]
function checkConstraint(value: Rational, constraints: Constraints): void {
  if (
    value.n < BigInt(constraints.min) * value.d ||
    value.n > BigInt(constraints.max) * value.d ||
    (constraints.nonNegative && value.n < 0n)
  ) {
    throw new Error("value outside constraints")
  }
}
function evaluate(
  ast: MathAst,
  context: {
    variable: string | null
    constraints: Constraints
    budget: { nodes: number }
    substitution?: Rational
  },
  depth = 0,
): Linear {
  const { variable, constraints, budget, substitution } = context
  budget.nodes += 1

  if (!ast || depth > 32 || budget.nodes > maxNodes) {
    throw new Error("invalid or too deep expression")
  }

  if (ast.kind === "integer") {
    checkConstraint(rational(numberInteger(ast.value), 1n), constraints)

    return {
      coefficient: zero,
      constant: rational(numberInteger(ast.value), 1n),
    }
  }

  if (ast.kind === "fraction") {
    checkConstraint(rational(numberInteger(ast.numerator), 1n), constraints)
    checkConstraint(rational(numberInteger(ast.denominator), 1n), constraints)
    checkConstraint(
      rational(numberInteger(ast.numerator), numberInteger(ast.denominator)),
      constraints,
    )

    return {
      coefficient: zero,
      constant: rational(
        numberInteger(ast.numerator),
        numberInteger(ast.denominator),
      ),
    }
  }

  if (ast.kind === "variable") {
    if (!variable || ast.name !== variable) {
      throw new Error("unexpected variable")
    }

    if (substitution) {
      checkConstraint(substitution, constraints)

      return { coefficient: zero, constant: substitution }
    }

    return { coefficient: one, constant: zero }
  }

  if (!["add", "subtract", "multiply", "divide", "power"].includes(ast.kind)) {
    throw new Error("unsupported expression")
  }

  const left = evaluate(ast.left, context, depth + 1)
  const right = evaluate(ast.right, context, depth + 1)
  const result = evaluateOperation(ast.kind, left, right)

  if (result.coefficient.n === 0n) {
    checkConstraint(result.constant, constraints)
  }

  return result
}
function evaluateOperation(
  kind: MathAst["kind"],
  left: Linear,
  right: Linear,
): Linear {
  switch (kind) {
    case "add":
      return {
        coefficient: add(left.coefficient, right.coefficient),
        constant: add(left.constant, right.constant),
      }

    case "subtract":
      return {
        coefficient: add(left.coefficient, neg(right.coefficient)),
        constant: add(left.constant, neg(right.constant)),
      }

    case "multiply":
      if (left.coefficient.n !== 0n && right.coefficient.n !== 0n) {
        throw new Error("nonlinear expression")
      }

      return {
        coefficient: add(
          mul(left.coefficient, right.constant),
          mul(right.coefficient, left.constant),
        ),
        constant: mul(left.constant, right.constant),
      }

    case "divide":
      if (right.coefficient.n !== 0n) {
        throw new Error("variable denominator")
      }

      return {
        coefficient: div(left.coefficient, right.constant),
        constant: div(left.constant, right.constant),
      }

    case "power": {
      if (
        right.coefficient.n !== 0n ||
        right.constant.d !== 1n ||
        right.constant.n < 0n ||
        right.constant.n > 8n
      ) {
        throw new Error("unsupported exponent")
      }

      const exponent = right.constant.n

      if (left.coefficient.n !== 0n && exponent > 1n) {
        throw new Error("nonlinear expression")
      }

      if (
        bitLength(left.constant.n) * Number(exponent) > maxBits ||
        bitLength(left.constant.d) * Number(exponent) > maxBits
      ) {
        throw new Error("expression exceeds arithmetic limit")
      }

      return exponent === 0n
        ? { coefficient: zero, constant: one }
        : {
            coefficient: left.coefficient,
            constant: rational(
              left.constant.n ** exponent,
              left.constant.d ** exponent,
            ),
          }
    }

    default:
      throw new Error("unsupported expression")
  }
}
function collectVariables(
  ast: MathAst,
  context: { names: Set<string>; nodes: number },
  depth = 0,
): void {
  const { names } = context
  context.nodes += 1

  if (!ast || depth > 32 || context.nodes > maxNodes) {
    throw new Error("invalid or too deep expression")
  }

  if (ast.kind === "variable") {
    if (!/^[a-zA-Z]$/u.test(ast.name)) {
      throw new Error("invalid variable name")
    }

    names.add(ast.name)
  } else if ("left" in ast && "right" in ast) {
    collectVariables(ast.left, context, depth + 1)
    collectVariables(ast.right, context, depth + 1)
  }
}
function solve(spec: MathProblemSpec): Rational {
  const ast = spec.expression

  if (spec.family === "linear_equation") {
    if (ast.kind !== "equation") {
      throw new Error("expected an equation")
    }

    const names = new Set<string>()
    collectVariables(ast, { names, nodes: 0 })

    if (names.size !== 1) {
      throw new Error("expected one variable")
    }

    const [variable] = [...names]
    const declared = Object.keys(spec.variables)

    if (declared.some((name) => name !== variable)) {
      throw new Error("unexpected variable declaration")
    }

    const budget = { nodes: 0 }
    const left = evaluate(ast.left, {
      variable,
      constraints: spec.constraints,
      budget,
    })
    const right = evaluate(ast.right, {
      variable,
      constraints: spec.constraints,
      budget,
    })

    const solution = div(
      add(right.constant, neg(left.constant)),
      add(left.coefficient, neg(right.coefficient)),
    )
    const valueBudget = { nodes: 0 }
    evaluate(ast.left, {
      variable,
      constraints: spec.constraints,
      budget: valueBudget,
      substitution: solution,
    })
    evaluate(ast.right, {
      variable,
      constraints: spec.constraints,
      budget: valueBudget,
      substitution: solution,
    })

    if (
      declared.length &&
      !equal(solution, rational(numberInteger(spec.variables[variable]), 1n))
    ) {
      throw new Error("variable declaration does not match solution")
    }

    return solution
  }

  if (Object.keys(spec.variables).length) {
    throw new Error("unexpected variable declaration")
  }

  if (spec.family === "fraction_addition") {
    if (
      ast.kind !== "add" ||
      ast.left.kind !== "fraction" ||
      ast.right.kind !== "fraction"
    ) {
      throw new Error("expected fraction addition")
    }
  } else if (spec.family === "percentage_of_quantity") {
    if (
      ast.kind !== "multiply" ||
      ast.left.kind !== "fraction" ||
      ast.left.denominator !== 100 ||
      ast.right.kind !== "integer"
    ) {
      throw new Error("expected percentage of quantity")
    }
  } else if (spec.family === "ratio") {
    if (
      ast.kind !== "divide" ||
      ast.left.kind !== "integer" ||
      ast.right.kind !== "integer"
    ) {
      throw new Error("expected ratio")
    }
  } else {
    throw new Error("unsupported family")
  }

  return evaluate(ast, {
    variable: null,
    constraints: spec.constraints,
    budget: { nodes: 0 },
  }).constant
}

export function verifyMathProblem(spec: MathProblemSpec): ValidationResult {
  try {
    if (
      !spec ||
      typeof spec.seed !== "string" ||
      !spec.variables ||
      typeof spec.variables !== "object" ||
      Array.isArray(spec.variables) ||
      !spec.constraints
    ) {
      throw new Error("invalid problem spec")
    }

    const { min, max, nonNegative } = spec.constraints

    if (
      !Number.isSafeInteger(min) ||
      !Number.isSafeInteger(max) ||
      min > max ||
      typeof nonNegative !== "boolean"
    ) {
      throw new Error("invalid constraints")
    }

    for (const value of Object.values(spec.variables)) {
      if (
        !Number.isSafeInteger(value) ||
        value < min ||
        value > max ||
        (nonNegative && value < 0)
      ) {
        throw new Error("variable outside constraints")
      }
    }
    const actual = solve(spec)
    const expected = answerValue(spec.answer)
    checkConstraint(actual, spec.constraints)
    checkConstraint(expected, spec.constraints)

    if (!equal(actual, expected)) {
      throw new Error("answer does not match expression")
    }

    if (spec.choices !== undefined) {
      if (!Array.isArray(spec.choices) || spec.choices.length < 2) {
        throw new Error("at least two choices required")
      }

      const seen = new Set<string>()
      let correct = 0
      for (const choice of spec.choices) {
        if (!choice || typeof choice.isCorrect !== "boolean") {
          throw new Error("invalid choice")
        }

        const value = answerValue(choice.answer)
        const key = `${value.n}/${value.d}`

        if (seen.has(key)) {
          throw new Error("duplicate equivalent choices")
        }

        seen.add(key)

        if (choice.isCorrect !== equal(value, actual)) {
          throw new Error("incorrect choice flag")
        }

        if (choice.isCorrect) {
          correct += 1
        }
      }

      if (correct !== 1) {
        throw new Error("exactly one correct choice required")
      }
    }

    return { valid: true, errors: [] }
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : "invalid problem"],
    }
  }
}

export function deriveDistractors(spec: MathProblemSpec): MathAnswer[] {
  const result = verifyMathProblem({ ...spec, choices: undefined })

  if (!result.valid) {
    throw new Error(result.errors.join("; "))
  }

  const value = answerValue(spec.answer)
  let hash = 2166136261
  for (const char of spec.seed) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  }
  const sign = hash % 2 ? 1n : -1n

  return [sign, -sign, sign * 2n].map((offset) => {
    const candidate = add(value, { n: offset, d: 1n })
    const numerator = Number(candidate.n)
    const denominator = Number(candidate.d)

    if (
      !Number.isSafeInteger(numerator) ||
      !Number.isSafeInteger(denominator)
    ) {
      throw new Error("distractor exceeds safe integer range")
    }

    return {
      kind: candidate.d === 1n ? "integer" : "rational",
      numerator,
      denominator,
    }
  })
}

export function renderCanonicalLatex(ast: MathAst): string {
  switch (ast.kind) {
    case "integer":
      return String(numberInteger(ast.value))

    case "fraction":
      rational(numberInteger(ast.numerator), numberInteger(ast.denominator))

      return `\\frac{${ast.numerator}}{${ast.denominator}}`

    case "variable":
      if (!/^[a-zA-Z]$/u.test(ast.name)) {
        throw new Error("invalid variable name")
      }

      return ast.name

    case "add":
      return `${renderCanonicalLatex(ast.left)} + ${renderCanonicalLatex(ast.right)}`

    case "subtract": {
      const right = renderCanonicalLatex(ast.right)
      const grouped = ast.right.kind === "add" || ast.right.kind === "subtract"

      return `${renderCanonicalLatex(ast.left)} - ${grouped ? `\\left(${right}\\right)` : right}`
    }

    case "multiply":
      return `\\left(${renderCanonicalLatex(ast.left)}\\right) \\cdot \\left(${renderCanonicalLatex(ast.right)}\\right)`

    case "divide":
      return `\\frac{${renderCanonicalLatex(ast.left)}}{${renderCanonicalLatex(ast.right)}}`

    case "power":
      return `\\left(${renderCanonicalLatex(ast.left)}\\right)^{${renderCanonicalLatex(ast.right)}}`

    case "equation":
      return `${renderCanonicalLatex(ast.left)} = ${renderCanonicalLatex(ast.right)}`

    default:
      throw new Error("unsupported expression")
  }
}
