import { describe, expect, it } from "vitest"
import { listPublishedTests } from "../src/repositories/catalog.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest } from "./helpers/fixtures.js"

describe("catalog cards", () => {
  it("carry the published testVersionId and the media size for the Save offline label", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const page = await listPublishedTests(pool, {
        studentId: f.studentId,
        limit: 10,
        cursor: null,
      })

      expect(page.tests[0]?.testVersionId).toBe(f.versionId)
      expect(page.tests[0]?.mediaBytes).toBe(123456)
    })
  })
})
