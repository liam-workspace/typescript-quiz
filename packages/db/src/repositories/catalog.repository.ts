import type { PgQueryable } from "@liam-public/node-postgres"
import type { SectionType } from "@pp/common"

export interface TestCardRow {
  id: string
  slug: string
  title: string
  level: "primary-step-1" | "primary-step-2" | null
  durationSeconds: number
  sections: Array<{ type: SectionType; questionCount: number }>
  inProgressAttemptId: string | null
  attemptCount: number
  bestAttempt: {
    attemptId: string
    submittedAt: string
    pointsEarned: number
    pointsPossible: number
    percentage: number
  } | null
}

export interface StudentSummary {
  attemptCount: number
  averagePct: number
  bestPct: number
}

export interface ListPublishedTestsResult {
  tests: TestCardRow[]
  nextCursor: string | null
  summary: StudentSummary
}

/**
 * Thrown when a supplied cursor cannot be decoded into a `(title, id)` pair.
 * The service layer maps this to 400 -- see the contract's `BadCursor`
 * response.
 */
export class InvalidCursorError extends Error {}

interface Cursor {
  title: string
  id: string
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

function isCursorShape(value: unknown): value is Cursor {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return typeof candidate.title === "string" && typeof candidate.id === "string"
}

function decodeCursor(raw: string): Cursor {
  let parsed: unknown = undefined

  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
  } catch {
    throw new InvalidCursorError("bad_cursor")
  }

  if (!isCursorShape(parsed)) {
    throw new InvalidCursorError("bad_cursor")
  }

  return parsed
}

interface SectionSummaryDbRow {
  type: string
  questionCount: number
}

interface CatalogPageDbRow {
  id: string
  slug: string
  title: string
  level: "primary-step-1" | "primary-step-2" | null
  duration_seconds: number
  sections: SectionSummaryDbRow[]
  in_progress_attempt_id: string | null
  attempt_count: string
  best_attempt_id: string | null
  best_submitted_at: Date | null
  best_points_earned: number | null
  best_points_possible: number | null
  best_percentage: string | null
}

interface SummaryDbRow {
  attempt_count: string
  average_pct: string
  best_pct: string
}

function toBestAttempt(row: CatalogPageDbRow): TestCardRow["bestAttempt"] {
  if (
    row.best_attempt_id === null ||
    row.best_submitted_at === null ||
    row.best_points_earned === null ||
    row.best_points_possible === null ||
    row.best_percentage === null
  ) {
    return null
  }

  return {
    attemptId: row.best_attempt_id,
    submittedAt: row.best_submitted_at.toISOString(),
    pointsEarned: row.best_points_earned,
    pointsPossible: row.best_points_possible,
    percentage: Number(row.best_percentage),
  }
}

function toTestCard(row: CatalogPageDbRow): TestCardRow {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    level: row.level,
    durationSeconds: row.duration_seconds,
    sections: row.sections.map((section) => ({
      type: section.type as SectionType,
      questionCount: section.questionCount,
    })),
    inProgressAttemptId: row.in_progress_attempt_id,
    attemptCount: Number(row.attempt_count),
    bestAttempt: toBestAttempt(row),
  }
}

/**
 * One row per published test, keyset-paginated on `(title, id)`. Three
 * LATERAL joins per row carry this student's standing -- in-progress
 * attempt id, finished-attempt count, and best finished attempt -- because
 * a plain GROUP BY cannot express "the whole best row" and three separate
 * round trips would not share the page's WHERE/ORDER/LIMIT. The
 * `attempt_standing_idx` index (student_id, test_version_id, status,
 * percentage DESC, submitted_at DESC) exists for exactly this shape.
 */
const PAGE_QUERY = `
  WITH page AS (
    SELECT t.id, t.slug, tv.id AS version_id, tv.title, tv.level, tv.duration_seconds
      FROM test t
      JOIN test_version tv ON tv.id = t.current_version_id AND tv.published_at IS NOT NULL
     WHERE $2::text IS NULL OR (tv.title, t.id) > ($2::text, $3::uuid)
     ORDER BY tv.title, t.id
     LIMIT $1
  )
  SELECT page.id, page.slug, page.title, page.level, page.duration_seconds,
         COALESCE(sec.sections, '[]'::jsonb) AS sections,
         ip.attempt_id AS in_progress_attempt_id,
         COALESCE(ac.attempt_count, 0) AS attempt_count,
         best.attempt_id AS best_attempt_id,
         best.submitted_at AS best_submitted_at,
         best.points_earned AS best_points_earned,
         best.points_possible AS best_points_possible,
         best.percentage AS best_percentage
    FROM page
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
               jsonb_build_object('type', s.type, 'questionCount', s.question_count)
               ORDER BY s.ordinal
             ) AS sections
        FROM (
          SELECT ts.ordinal, ts.type, count(q.id) AS question_count
            FROM test_section ts
            LEFT JOIN question_group qg ON qg.test_section_id = ts.id
            LEFT JOIN question q ON q.question_group_id = qg.id
           WHERE ts.test_version_id = page.version_id
           GROUP BY ts.id, ts.ordinal, ts.type
        ) s
    ) sec ON true
    LEFT JOIN LATERAL (
      SELECT a.id AS attempt_id
        FROM attempt a
       WHERE a.student_id = $4 AND a.test_version_id = page.version_id
         AND a.status = 'in_progress'
       LIMIT 1
    ) ip ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS attempt_count
        FROM attempt a
       WHERE a.student_id = $4 AND a.test_version_id = page.version_id
         AND a.status <> 'in_progress'
    ) ac ON true
    LEFT JOIN LATERAL (
      SELECT a.id AS attempt_id, a.submitted_at, a.points_earned, a.points_possible, a.percentage
        FROM attempt a
       WHERE a.student_id = $4 AND a.test_version_id = page.version_id
         AND a.status <> 'in_progress'
       ORDER BY a.percentage DESC, a.submitted_at DESC
       LIMIT 1
    ) best ON true
   ORDER BY page.title, page.id
`

/**
 * A separate aggregate query over ALL of this student's attempts, not
 * derived from the current page -- deriving it from the page would give a
 * different answer per page.
 */
const SUMMARY_QUERY = `
  SELECT count(*) AS attempt_count,
         COALESCE(avg(percentage), 0) AS average_pct,
         COALESCE(max(percentage), 0) AS best_pct
    FROM attempt
   WHERE student_id = $1 AND status <> 'in_progress'
`

export async function listPublishedTests(
  db: PgQueryable,
  input: { studentId: string; limit: number; cursor: string | null },
): Promise<ListPublishedTestsResult> {
  const decoded = input.cursor === null ? null : decodeCursor(input.cursor)

  const [pageResult, summaryResult] = await Promise.all([
    db.query<CatalogPageDbRow>(PAGE_QUERY, [
      input.limit + 1,
      decoded?.title ?? null,
      decoded?.id ?? null,
      input.studentId,
    ]),
    db.query<SummaryDbRow>(SUMMARY_QUERY, [input.studentId]),
  ])

  const hasMore = pageResult.rows.length > input.limit
  const pageRows = hasMore
    ? pageResult.rows.slice(0, input.limit)
    : pageResult.rows
  const tests = pageRows.map(toTestCard)
  const lastTest = tests[tests.length - 1]
  const nextCursor = hasMore
    ? encodeCursor({ title: lastTest.title, id: lastTest.id })
    : null

  const [summaryRow] = summaryResult.rows

  return {
    tests,
    nextCursor,
    summary: {
      attemptCount: Number(summaryRow.attempt_count),
      averagePct: Number(summaryRow.average_pct),
      bestPct: Number(summaryRow.best_pct),
    },
  }
}
