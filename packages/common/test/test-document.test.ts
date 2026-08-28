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

  // Allowlist is the one XSS-relevant check in this pipeline (both fields
  // render with dangerouslySetInnerHTML) -- these pin that the allowlist
  // rejects what it should, and does not reject an ordinary pictogram in
  // the same shape the real TOEFL Primary content uses.
  //
  // Built as a fresh literal rather than mutating `valid`: `valid` is typed
  // from its own literal shape (no `imageSvg` in it), and safeParse's input
  // is `unknown` anyway -- there is nothing to gain by fighting that here.
  describe("imageSvg", () => {
    const pictogram =
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><path d="M50 40 L50 76" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="50" cy="30" r="10" fill="currentColor"/></svg>'

    function docWithChoiceImage(imageSvg: string): unknown {
      const doc = structuredClone(valid)

      return {
        ...doc,
        sections: [
          {
            ...doc.sections[0],
            groups: [
              {
                ...doc.sections[0].groups[0],
                questions: [
                  {
                    ...doc.sections[0].groups[0].questions[0],
                    choices: [
                      {
                        ...doc.sections[0].groups[0].questions[0].choices[0],
                        imageSvg,
                      },
                      doc.sections[0].groups[0].questions[0].choices[1],
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }
    }

    it("accepts an ordinary pictogram on a choice", () => {
      const parsed = testDocumentSchema.parse(docWithChoiceImage(pictogram))

      expect(
        parsed.sections[0].groups[0].questions[0].choices[0].imageSvg,
      ).toBe(pictogram)
    })

    it("accepts an ordinary pictogram on a stimulus", () => {
      const doc = docWith({ type: "image", imageSvg: pictogram })
      const parsed = testDocumentSchema.parse(doc)

      expect(parsed.sections[0].groups[0].stimulus?.imageSvg).toBe(pictogram)
    })

    it.each([
      ["a script tag", `${pictogram}<script>alert(1)</script>`],
      ["an onload handler", '<svg onload="alert(1)"><path d="M0 0"/></svg>'],
      [
        "an unquoted onload handler",
        "<svg onload=alert(1)><path d='M0 0'/></svg>",
      ],
      [
        "a foreignObject",
        "<svg><foreignObject><p>hi</p></foreignObject></svg>",
      ],
      [
        "an image tag with an href",
        '<svg><image href="javascript:alert(1)"/></svg>',
      ],
      ["a disallowed attribute", '<svg style="x"><path d="M0 0"/></svg>'],
    ])("rejects %s", (_label, svg) => {
      expect(
        testDocumentSchema.safeParse(docWithChoiceImage(svg)).success,
      ).toBe(false)
    })
  })
})
