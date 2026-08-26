import type { RunnerChoice, RunnerQuestion } from "./domain/test.js"

/** Used only by the scoring service. Never serialized to a student. */
export interface ScoringChoice extends RunnerChoice {
  isCorrect: boolean
}

export interface ScoringQuestion extends Omit<RunnerQuestion, "choices"> {
  points: number
  choices: ScoringChoice[]
}
