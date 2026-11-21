import { describe, expect, it } from "vitest"
import {
  adminPaginationSchema,
  adminTestFilterSchema,
  draftQuestionPatchSchema,
  type AdminAuditAction,
  type AdminQuestion,
} from "../src/admin-contract.js"

describe("admin contracts", () => {
  it("accepts persisted and planned audit action values", () => {
    const actions: AdminAuditAction[] = [
      "attempt_detail_viewed",
      "draft_question_updated",
    ]
    expect(actions).toEqual(["attempt_detail_viewed", "draft_question_updated"])
  })

  it("accepts bounded pagination and optional catalogue filters", () => {
    expect(adminPaginationSchema.parse({ limit: 25, cursor: null })).toEqual({
      limit: 25,
      cursor: null,
    })
    expect(
      adminTestFilterSchema.parse({ status: "published", search: "math" }),
    ).toEqual({
      status: "published",
      search: "math",
    })
  })

  it("rejects malformed pagination and unknown filter properties", () => {
    expect(
      adminPaginationSchema.safeParse({ limit: 0, cursor: null }).success,
    ).toBe(false)
    expect(
      adminTestFilterSchema.safeParse({ status: "invalid", extra: true })
        .success,
    ).toBe(false)
  })

  it("accepts prompt and choice edits including correct-choice state", () => {
    expect(
      draftQuestionPatchSchema.parse({
        prompt: "Updated?",
        choices: [
          { id: "choice-a", label: "A", isCorrect: false },
          { id: "choice-b", label: "B", isCorrect: true },
        ],
      }),
    ).toEqual({
      prompt: "Updated?",
      choices: [
        { id: "choice-a", label: "A", isCorrect: false },
        { id: "choice-b", label: "B", isCorrect: true },
      ],
    })
  })

  it("requires a stable choice ID", () => {
    expect(
      draftQuestionPatchSchema.safeParse({
        choices: [
          { label: "A", isCorrect: true },
          { id: "choice-b", label: "B", isCorrect: false },
        ],
      }).success,
    ).toBe(false)
    expect(
      draftQuestionPatchSchema.safeParse({
        choices: [
          { id: "", label: "A", isCorrect: true },
          { id: "choice-b", label: "B", isCorrect: false },
        ],
      }).success,
    ).toBe(false)
  })

  it("requires isCorrect for each choice", () => {
    expect(
      draftQuestionPatchSchema.safeParse({
        choices: [
          { id: "choice-a", label: "A" },
          { id: "choice-b", label: "B", isCorrect: false },
        ],
      }).success,
    ).toBe(false)
  })

  it("rejects unknown fields in choice items", () => {
    expect(
      draftQuestionPatchSchema.safeParse({
        choices: [
          { id: "choice-a", label: "A", isCorrect: true, extra: true },
          { id: "choice-b", label: "B", isCorrect: false },
        ],
      }).success,
    ).toBe(false)
    expect(
      draftQuestionPatchSchema.safeParse({ answerKey: ["a"] }).success,
    ).toBe(false)
    expect(
      draftQuestionPatchSchema.safeParse({ prompt: "valid", extra: true })
        .success,
    ).toBe(false)
  })

  it("requires at least two choices", () => {
    expect(
      draftQuestionPatchSchema.safeParse({
        choices: [{ id: "choice-a", label: "A", isCorrect: true }],
      }).success,
    ).toBe(false)
  })

  it("rejects blank choice labels", () => {
    expect(
      draftQuestionPatchSchema.safeParse({
        choices: [
          { id: "choice-a", label: "", isCorrect: true },
          { id: "choice-b", label: "B", isCorrect: false },
        ],
      }).success,
    ).toBe(false)
  })

  it("includes correct-choice state in the admin question projection", () => {
    const question: AdminQuestion = {
      id: "question-1",
      prompt: "Pick one",
      choices: [{ id: "choice-a", label: "A", isCorrect: true }],
    }
    expect(question.choices[0]?.isCorrect).toBe(true)
  })
})
