import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"

function toText(row: { text: string }): string {
  return row.text
}

async function seedTestWithOneDraft(pool: import("pg").Pool) {
  await pool.query(
    `INSERT INTO test (id, slug) VALUES ('22222222-2222-2222-2222-222222222222','t04')`,
  )
  await pool.query(
    `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
     VALUES ('a0000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',1,'T04',3000)`,
  )
}

describe("migration 1001 — content", () => {
  it("permits only one unpublished draft per test", async () => {
    await withDatabase(async (pool) => {
      await seedTestWithOneDraft(pool)
      await expect(
        pool.query(
          `INSERT INTO test_version (test_id, version, title, duration_seconds)
           VALUES ('22222222-2222-2222-2222-222222222222',2,'T04',3000)`,
        ),
      ).rejects.toThrow(/test_version_one_draft/)
    })
  }, 120_000)

  it("refuses a question group whose section belongs to another version", async () => {
    await withDatabase(async (pool) => {
      await seedTestWithOneDraft(pool)
      await pool.query(
        `INSERT INTO test_section (id, test_version_id, ordinal, title, type,
                                   duration_seconds, navigation, allow_answer_change)
         VALUES ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
                 1,'L','listening',3000,'forward_only',false)`,
      )
      // A group claiming a different version than its section
      await expect(
        pool.query(
          `INSERT INTO question_group (test_version_id, test_section_id, ordinal)
           VALUES ('a0000000-0000-0000-0000-0000000000ff','b0000000-0000-0000-0000-000000000001',1)`,
        ),
      ).rejects.toThrow(/group_section_fk/)
    })
  }, 120_000)

  it("keeps instruction order stable", async () => {
    await withDatabase(async (pool) => {
      await seedTestWithOneDraft(pool)
      await pool.query(
        `INSERT INTO test_section (id, test_version_id, ordinal, title, type,
                                   duration_seconds, navigation, allow_answer_change)
         VALUES ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
                 1,'L','listening',3000,'forward_only',false)`,
      )
      await pool.query(
        `INSERT INTO section_instruction (test_section_id, ordinal, text) VALUES
           ('b0000000-0000-0000-0000-000000000001', 2, 'second'),
           ('b0000000-0000-0000-0000-000000000001', 1, 'first')`,
      )
      const { rows } = await pool.query<{ text: string }>(
        `SELECT text FROM section_instruction
          WHERE test_section_id='b0000000-0000-0000-0000-000000000001' ORDER BY ordinal`,
      )
      expect(rows.map(toText)).toEqual(["first", "second"])
    })
  }, 120_000)

  it("rejects a section whose playback booleans are half-set", async () => {
    await withDatabase(async (pool) => {
      await seedTestWithOneDraft(pool)
      await expect(
        pool.query(
          `INSERT INTO test_section (test_version_id, ordinal, title, type, duration_seconds,
                                     navigation, allow_answer_change, default_allow_pause)
           VALUES ('a0000000-0000-0000-0000-000000000001',1,'L','listening',3000,
                   'forward_only',false,false)`,
        ),
      ).rejects.toThrow(/section_playback_all_or_nothing/)
    })
  }, 120_000)
})
