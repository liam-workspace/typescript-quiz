import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"

const OPENAPI = resolve(process.cwd(), "../../docs/api/openapi.yaml")

interface EnumPair {
  schemaName: string
  typeName: string
}

/**
 * The six enums that each have exactly one named OpenAPI component
 * ($ref'd wherever the full value set is genuinely used) matching one SQL
 * enum type one-for-one. `attempt_status` is excluded — see the comment on
 * the directional test below for why it can't be checked the same way.
 */
const ENUM_PAIRS: EnumPair[] = [
  { schemaName: "SectionType", typeName: "section_type" },
  { schemaName: "NavigationMode", typeName: "nav_mode" },
  { schemaName: "QuestionType", typeName: "question_type" },
  { schemaName: "StimulusType", typeName: "stimulus_type" },
  { schemaName: "MediaKind", typeName: "media_kind" },
  { schemaName: "StudentLevel", typeName: "student_level" },
]

/**
 * Every schema whose `status` property carries an `attempt_status` value.
 * None of them is meant to allow all three values at once (see below), so
 * there is no single named component to point at — this list stands in
 * for one.
 */
const ATTEMPT_STATUS_CARRIERS = [
  "AttemptStart",
  "FinalizedAttempt",
  "RunnerEnvelope",
  "SubmitResult",
  "AttemptResult",
  "AttemptHistoryRow",
]

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

/**
 * The text of one top-level `components.schemas` entry, from its name up
 * to (but not including) the next one — so a search inside it can't spill
 * over into an unrelated schema that happens to also have a `status`
 * property with different values.
 */
function schemaBlock(spec: string, schemaName: string): string {
  const startMarker = `\n    ${schemaName}:\n`
  const start = spec.indexOf(startMarker)

  if (start === -1) {
    throw new Error(`no schema block for ${schemaName} in openapi.yaml`)
  }

  const bodyStart = start + startMarker.length
  const rest = spec.slice(bodyStart)
  const nextSchema = rest.search(/\n {4}[A-Za-z][\w-]*:\n/)

  return nextSchema === -1 ? rest : rest.slice(0, nextSchema)
}

/** The attempt-status value(s) one schema block's `status` property allows. */
function statusValuesIn(block: string, schemaName: string): string[] {
  const m = /status:\s*\{[^}]*\}|status:\s*\n(?:\s+\S.*\n)+/.exec(block)

  if (!m) {
    throw new Error(`no status property in ${schemaName} in openapi.yaml`)
  }

  const enumMatch = /enum: \[([^\]]*)\]/.exec(m[0])

  if (enumMatch) {
    return enumMatch[1].split(",").map((s) => s.trim())
  }

  const constMatch = /const: (\S+)/.exec(m[0])

  if (!constMatch) {
    throw new Error(
      `status property in ${schemaName} has neither enum nor const`,
    )
  }

  return [constMatch[1]]
}

/** Every attempt-status value used anywhere across the narrowed carriers. */
function apiAttemptStatusValues(spec: string): string[] {
  const values = new Set<string>()

  for (const schemaName of ATTEMPT_STATUS_CARRIERS) {
    const block = schemaBlock(spec, schemaName)

    for (const value of statusValuesIn(block, schemaName)) {
      values.add(value)
    }
  }

  return [...values].sort()
}

/** Label of a `pg_enum` row, hoisted so `rows.map` isn't a nested callback. */
function labelOf(row: { label: string }): string {
  return row.label
}

/** Sorted enum labels PostgreSQL has for the named enum type. */
async function sqlEnum(pool: pg.Pool, typeName: string): Promise<string[]> {
  const { rows } = await pool.query<{ label: string }>(
    `SELECT enumlabel AS label FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1`,
    [typeName],
  )

  return rows.map(labelOf).sort()
}

describe("enum parity", () => {
  it.each(ENUM_PAIRS)(
    "$schemaName matches $typeName",
    async ({ schemaName, typeName }) => {
      const spec = readFileSync(OPENAPI, "utf8")

      await withDatabase(async (pool) => {
        expect(await sqlEnum(pool, typeName)).toEqual(
          openApiEnum(spec, schemaName),
        )
      })
    },
    120_000,
  )

  /**
   * The `attempt_status` enum is guarded differently from the other six. Every
   * exposure of it in the spec is a deliberate narrowing — AttemptStart
   * only ever reports `in_progress`, FinalizedAttempt only `expired`, and
   * so on — because no single endpoint response is meant to let an
   * attempt claim all three states at once. That means there is no
   * schema with the full three-value set to promote to a named
   * `AttemptStatus` component and $ref, so the symmetric
   * "one component equals one SQL enum" check above doesn't apply here.
   *
   * What can still drift, and is worth guarding, is the dangerous
   * direction: an endpoint naming a status value the database has no
   * room to store. So this collects every attempt-status value written
   * anywhere across the narrowed carriers and asserts each one is a
   * member of the SQL enum. The opposite direction — attempt_status
   * gaining a value no endpoint exposes yet — is a normal, safe
   * authoring step (not drift), and is deliberately left unchecked.
   */
  it("every attempt-status value in the spec exists in attempt_status", async () => {
    const spec = readFileSync(OPENAPI, "utf8")

    await withDatabase(async (pool) => {
      const sqlValues = await sqlEnum(pool, "attempt_status")

      for (const value of apiAttemptStatusValues(spec)) {
        expect(sqlValues, `"${value}" is not a legal attempt_status`).toContain(
          value,
        )
      }
    })
  }, 120_000)
})
