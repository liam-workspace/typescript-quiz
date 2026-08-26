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
})
