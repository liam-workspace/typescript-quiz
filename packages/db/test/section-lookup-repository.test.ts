import { describe, expect, it } from "vitest"
import { loadQuestionSectionInfo } from "../src/repositories/section-lookup.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest } from "./helpers/fixtures.js"

describe("section-lookup repository", () => {
  it("maps each question to its section and section rules", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)

      const map = await loadQuestionSectionInfo(pool, {
        testVersionId: fixture.versionId,
        questionIds: fixture.questionIds,
      })

      expect(map.size).toBe(2)
      expect(map.get(fixture.questionIds[0])).toEqual({
        sectionId: fixture.listeningSectionId,
        allowAnswerChange: false,
        navigation: "forward_only",
      })
      expect(map.get(fixture.questionIds[1])).toEqual({
        sectionId: fixture.readingSectionId,
        allowAnswerChange: true,
        navigation: "free",
      })
    })
  }, 120_000)

  it("omits an id that does not resolve to a question in this version", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const unknownQuestionId = "00000000-0000-0000-0000-000000000000"

      const map = await loadQuestionSectionInfo(pool, {
        testVersionId: fixture.versionId,
        questionIds: [fixture.questionIds[0], unknownQuestionId],
      })

      expect(map.size).toBe(1)
      expect(map.has(unknownQuestionId)).toBe(false)
    })
  }, 120_000)
})
