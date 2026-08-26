import { describe, expect, it } from "vitest"
import { testDocumentSchema } from "../src/interchange/test-document.js"

const valid = {
  title: "TOEFL Primary — Practice Test 04",
  slug: "practice-test-04",
  level: "primary-step-1",
  durationSeconds: 1500,
  sections: [
    {
      title: "Listening — Part 1",
      type: "listening",
      durationSeconds: 1500,
      navigation: "forward_only",
      allowAnswerChange: false,
      playback: { maxPlays: 1, allowPause: false, allowSeek: false },
      instructions: ["Put your headphones on now."],
      groups: [
        {
          stimulus: { type: "audio", mediaFilename: "l07.mp3", maxPlays: 1 },
          questions: [
            {
              questionKey: "q1",
              prompt: "What does the boy want to do?",
              type: "single_choice",
              points: 1,
              choices: [
                { label: "Read a book", isCorrect: true },
                { label: "Play football", isCorrect: false },
              ],
            },
          ],
        },
      ],
    },
  ],
}

/**
 * `valid` with its only stimulus (and optionally its only section playback)
 * overridden. Returns `unknown` on purpose: these cases are about inputs the
 * schema must REJECT, which by definition do not fit the parsed type.
 */
function docWith(
  stimulus: Record<string, unknown>,
  playback: Record<string, unknown> = {},
): unknown {
  const doc = structuredClone(valid)
  const [section] = doc.sections
  const [group] = section.groups

  return {
    ...doc,
    sections: [
      {
        ...section,
        playback: { ...section.playback, ...playback },
        groups: [{ ...group, stimulus: { ...group.stimulus, ...stimulus } }],
      },
    ],
  }
}

/** Dotted path of the first issue raised, for a document that must be rejected. */
function firstIssuePath(input: unknown): string {
  const result = testDocumentSchema.safeParse(input)

  if (result.success) {
    throw new Error("expected the document to be rejected, but it parsed")
  }

  return result.error.issues[0].path.map(String).join(".")
}

describe("testDocumentSchema", () => {
  it("accepts a well-formed document", () => {
    expect(testDocumentSchema.parse(valid).sections[0].instructions).toEqual([
      "Put your headphones on now.",
    ])
  })

  it("rejects a question with fewer than two choices", () => {
    const bad = structuredClone(valid)

    bad.sections[0].groups[0].questions[0].choices = [
      { label: "only", isCorrect: true },
    ]
    expect(() => testDocumentSchema.parse(bad)).toThrow(/at least 2/i)
  })

  it("rejects a single_choice question without exactly one correct choice", () => {
    const bad = structuredClone(valid)

    bad.sections[0].groups[0].questions[0].choices = [
      { label: "a", isCorrect: true },
      { label: "b", isCorrect: true },
    ]
    expect(() => testDocumentSchema.parse(bad)).toThrow(/exactly one correct/i)
  })

  it("rejects a stimulus playback that loosens the section default", () => {
    const bad = structuredClone(valid)

    // Section default is 1.
    bad.sections[0].groups[0].stimulus.maxPlays = 3
    expect(() => testDocumentSchema.parse(bad)).toThrow(/tighten/i)
  })

  // "Absent" must have exactly one spelling, or the import/export round trip
  // is not identity: export omits an empty text column rather than emitting
  // "", and omits an inherited cap rather than emitting null.
  it.each([
    { field: "title", value: "" },
    { field: "bodyText", value: "" },
    { field: "mediaFilename", value: "" },
  ])("rejects an empty-string stimulus $field", ({ field, value }) => {
    expect(firstIssuePath(docWith({ [field]: value }))).toBe(
      `sections.0.groups.0.stimulus.${field}`,
    )
  })

  it("rejects an explicit null stimulus maxPlays", () => {
    expect(firstIssuePath(docWith({ maxPlays: null }))).toBe(
      "sections.0.groups.0.stimulus.maxPlays",
    )
  })

  // The same key one level up keeps its null: on a section playback, null
  // means "unlimited", which is a value, not an absence.
  it("still accepts a null playback maxPlays on a section", () => {
    const parsed = testDocumentSchema.parse(
      docWith({ maxPlays: 3 }, { maxPlays: null }),
    )

    expect(parsed.sections[0].playback).toEqual({
      maxPlays: null,
      allowPause: false,
      allowSeek: false,
    })
  })
})
