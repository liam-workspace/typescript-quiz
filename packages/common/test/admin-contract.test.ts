import { describe, expect, it } from "vitest"
import {
  adminPaginationSchema,
  adminTestFilterSchema,
  draftQuestionPatchSchema,
} from "../src/admin-contract.js"

describe("admin contracts", () => {
  it("accepts bounded pagination and optional catalogue filters", () => {
    expect(adminPaginationSchema.parse({ limit: 25, cursor: null })).toEqual({
      limit: 25,
      cursor: null,
    })
    expect(adminTestFilterSchema.parse({ status: "published", search: "math" })).toEqual({
      status: "published",
      search: "math",
    })
  })

  it("rejects malformed pagination and unknown filter properties", () => {
    expect(adminPaginationSchema.safeParse({ limit: 0, cursor: null }).success).toBe(false)
    expect(adminTestFilterSchema.safeParse({ status: "invalid", extra: true }).success).toBe(false)
  })

  it("accepts prompt and choice text edits while rejecting answer key and unknown fields", () => {
    expect(draftQuestionPatchSchema.parse({ prompt: "Updated?", choices: [{ label: "A" }, { label: "B" }] })).toEqual({
      prompt: "Updated?",
      choices: [{ label: "A" }, { label: "B" }],
    })
    expect(draftQuestionPatchSchema.safeParse({ answerKey: ["a"] }).success).toBe(false)
    expect(draftQuestionPatchSchema.safeParse({ choices: [{ label: "", isCorrect: true }] }).success).toBe(false)
    expect(draftQuestionPatchSchema.safeParse({ prompt: "valid", extra: true }).success).toBe(false)
  })
})
