import { withTransaction } from "@liam-workspace/node-postgres"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest } from "./helpers/fixtures.js"
import { loadForScoring } from "../src/repositories/test-version.repository.js"

// Mirrors the `idEquals` helper in projections.test.ts: comparing branded
// ids against the fixture's plain-string ids without fighting the branding
// at the type level.
function idEquals(id: unknown) {
  return (item: { id: unknown }): boolean => item.id === id
}

// Hoisted so `describe > it > withDatabase > withTransaction` does not add a
// fourth level of nested callback (oxlint max-nested-callbacks: 3).
function loadForScoringViaTransaction(pool: pg.Pool, versionId: string) {
  return withTransaction(pool, (tx) => loadForScoring(tx, versionId))
}

describe("loadForScoring — section projection", () => {
  it("carries sectionId on every scoring question, matching the seeded sections", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const questions = await loadForScoring(pool, f.versionId)

      expect(questions).toHaveLength(2)

      // The fixture's first question belongs to the listening group
      // (groupL), and its second to the reading group (groupR) -- two
      // different sections, so a query that stamped every question with the
      // same section (e.g. only the first joined row) cannot pass this.
      const listeningQuestion = questions.find(idEquals(f.questionIds[0]))
      const readingQuestion = questions.find(idEquals(f.questionIds[1]))

      if (!listeningQuestion || !readingQuestion) {
        throw new Error("expected both fixture questions to be present")
      }

      expect(String(listeningQuestion.sectionId)).toBe(f.listeningSectionId)
      expect(String(readingQuestion.sectionId)).toBe(f.readingSectionId)
    })
  }, 120_000)

  it("is callable with a transaction client, not only a bare Pool", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)

      const questions = await loadForScoringViaTransaction(pool, f.versionId)

      expect(questions).toHaveLength(2)

      const listeningQuestion = questions.find(idEquals(f.questionIds[0]))
      const readingQuestion = questions.find(idEquals(f.questionIds[1]))

      if (!listeningQuestion || !readingQuestion) {
        throw new Error("expected both fixture questions to be present")
      }

      expect(String(listeningQuestion.sectionId)).toBe(f.listeningSectionId)
      expect(String(readingQuestion.sectionId)).toBe(f.readingSectionId)
    })
  }, 120_000)
})
