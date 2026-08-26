import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"

const OPENAPI = resolve(process.cwd(), "../../docs/api/openapi.yaml")

/** Members of a named enum as declared in openapi.yaml. */
function openApiEnum(spec: string, schemaName: string): string[] {
  const block = new RegExp(
    `    ${schemaName}:\\n      type: string\\n      enum: \\[([^\\]]*)\\]`,
  )
  const m = spec.match(block)

  if (!m) {
    throw new Error(`no enum block for ${schemaName} in openapi.yaml`)
  }

  return m[1]
    .split(",")
    .map((s) => s.trim())
    .sort()
}

/** Label of a `pg_enum` row, hoisted so `rows.map` isn't a nested callback. */
function labelOf(row: { label: string }): string {
  return row.label
}

describe("enum parity", () => {
  it("SectionType matches section_type", async () => {
    const spec = readFileSync(OPENAPI, "utf8")

    await withDatabase(async (pool) => {
      const { rows } = await pool.query<{ label: string }>(
        `SELECT enumlabel AS label FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='section_type'`,
      )
      expect(rows.map(labelOf).sort()).toEqual(openApiEnum(spec, "SectionType"))
    })
  }, 120_000)

  it("NavigationMode matches nav_mode", async () => {
    const spec = readFileSync(OPENAPI, "utf8")

    await withDatabase(async (pool) => {
      const { rows } = await pool.query<{ label: string }>(
        `SELECT enumlabel AS label FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='nav_mode'`,
      )
      expect(rows.map(labelOf).sort()).toEqual(
        openApiEnum(spec, "NavigationMode"),
      )
    })
  }, 120_000)
})
