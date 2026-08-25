import type pg from "pg"
import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"

const EXPECTED_ENUMS = {
  section_type: ["listening", "reading", "vocabulary", "grammar"],
  nav_mode: ["free", "forward_only"],
  stimulus_type: ["audio", "passage", "image", "mixed"],
  question_type: ["single_choice", "multi_choice"],
  attempt_status: ["in_progress", "submitted", "expired"],
  media_kind: ["audio", "image"],
  student_level: ["primary-step-1", "primary-step-2"],
}

async function fetchEnumLabels(
  pool: pg.Pool,
  typeName: string,
): Promise<string[]> {
  const { rows } = await pool.query<{ label: string }>(
    `SELECT e.enumlabel AS label
       FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = $1
      ORDER BY e.enumsortorder`,
    [typeName],
  )
  const labels: string[] = []

  for (const row of rows) {
    labels.push(row.label)
  }

  return labels
}

describe("migration 1000", () => {
  it("creates every enum with exactly the documented members", async () => {
    await withDatabase(async (pool) => {
      const entries = Object.entries(EXPECTED_ENUMS)
      const pending: Array<Promise<string[]>> = []

      for (const [name] of entries) {
        pending.push(fetchEnumLabels(pool, name))
      }

      const labelSets = await Promise.all(pending)

      for (const [index, [name, members]] of entries.entries()) {
        expect(labelSets[index], name).toEqual(members)
      }
    })
  }, 120_000)

  it("rejects a student with a blank display name", async () => {
    await withDatabase(async (pool) => {
      await expect(
        pool.query(
          `INSERT INTO student (subject_claim, email, display_name)
           VALUES ('s1', 'a@b', '   ')`,
        ),
      ).rejects.toThrow(/student_name_not_blank/)
    })
  }, 120_000)
})
