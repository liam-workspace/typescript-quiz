import { describe, expect, it } from "vitest"
import { testDocumentSchema, type TestDocument } from "@pp/common"
import { withDatabase } from "./helpers/database.js"
import {
  exportTestDocument,
  importTestDocument,
} from "../src/repositories/test-import.repository.js"

const doc: TestDocument = testDocumentSchema.parse({
  title: "TOEFL Primary — Practice Test 04",
  slug: "practice-test-04",
  level: "primary-step-1",
  durationSeconds: 3000,
  sections: [
    {
      title: "Listening — Part 1",
      type: "listening",
      durationSeconds: 1500,
      navigation: "forward_only",
      allowAnswerChange: false,
      playback: { maxPlays: 1, allowPause: false, allowSeek: false },
      instructions: ["Put your headphones on now.", "Stay quiet."],
      groups: [
        {
          questions: [
            {
              questionKey: "q1",
              prompt: "A?",
              type: "single_choice",
              points: 1,
              tags: ["gist", "detail"],
              choices: [
                { label: "yes", isCorrect: true },
                { label: "no", isCorrect: false },
              ],
            },
          ],
        },
      ],
    },
    {
      title: "Reading",
      type: "reading",
      durationSeconds: 1500,
      navigation: "free",
      allowAnswerChange: true,
      playback: null,
      instructions: [],
      groups: [
        {
          stimulus: {
            type: "passage",
            title: "The School Trip",
            bodyText: "On Friday…",
          },
          questions: [
            {
              questionKey: "q2",
              prompt: "B?",
              type: "single_choice",
              points: 1,
              choices: [
                { label: "rain", isCorrect: true },
                { label: "bus", isCorrect: false },
              ],
            },
          ],
        },
      ],
    },
  ],
})

describe("import / export", () => {
  it("round-trips a document unchanged", async () => {
    await withDatabase(async (pool) => {
      const { versionId } = await importTestDocument(pool, doc)
      const out = await exportTestDocument(pool, versionId)

      expect(out).toEqual(doc)
    })
  }, 120_000)

  it("preserves instruction and tag ORDER", async () => {
    await withDatabase(async (pool) => {
      const { versionId } = await importTestDocument(pool, doc)
      const out = await exportTestDocument(pool, versionId)

      expect(out.sections[0].instructions).toEqual([
        "Put your headphones on now.",
        "Stay quiet.",
      ])
      expect(out.sections[0].groups[0].questions[0].tags).toEqual([
        "gist",
        "detail",
      ])
    })
  }, 120_000)

  it("creates a DRAFT — importing does not publish", async () => {
    await withDatabase(async (pool) => {
      const { versionId } = await importTestDocument(pool, doc)
      const { rows } = await pool.query<{ published_at: string | null }>(
        `SELECT published_at FROM test_version WHERE id=$1`,
        [versionId],
      )

      expect(rows[0].published_at).toBeNull()
    })
  }, 120_000)
})
