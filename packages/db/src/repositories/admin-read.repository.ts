import type { PgQueryable } from "@liam-workspace/node-postgres"
import {
  adminPaginationSchema,
  asChoiceId,
  asQuestionId,
  asSectionId,
  isQuestionCorrect,
  type AdminAttemptDetail,
  type AdminLearnerPage,
  type AdminOverview,
  type AdminPagination,
  type AdminResultPage,
  type AdminResultSummary,
  type AdminTestDetail,
  type AdminTestFilter,
  type AdminTestPage,
  type AdminTestSummary,
  type QuestionType,
} from "@pp/common"
import { InvalidCursorError } from "./catalog.repository.js"

interface Cursor {
  kind: "tests" | "results" | "learners"
  key: string
  id: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function decodeCursor(
  input: AdminPagination,
  kind: Cursor["kind"],
): Cursor | null {
  const { cursor } = adminPaginationSchema.parse({
    limit: input.limit,
    cursor: input.cursor,
  })

  if (cursor === null) {
    return null
  }

  let value: unknown = undefined

  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
  } catch {
    throw new InvalidCursorError("bad_cursor")
  }

  if (typeof value !== "object" || value === null) {
    throw new InvalidCursorError("bad_cursor")
  }

  const candidate = value as Record<string, unknown>

  if (
    candidate.kind !== kind ||
    typeof candidate.key !== "string" ||
    typeof candidate.id !== "string" ||
    !UUID_PATTERN.test(candidate.id) ||
    (kind === "results" && Number.isNaN(Date.parse(candidate.key)))
  ) {
    throw new InvalidCursorError("bad_cursor")
  }

  return { kind, key: candidate.key, id: candidate.id }
}

function encodeCursor(kind: Cursor["kind"], key: string, id: string): string {
  return Buffer.from(JSON.stringify({ kind, key, id })).toString("base64url")
}

interface TestDbRow {
  id: string
  title: string
  status: "draft" | "published"
  current_version_id: string | null
  updated_at: Date
  version_id: string
  duration_seconds: number
}

// Current publication and the latest editable version are independent. A test
// with a published v1 and draft v2 must display v2 as draft, while preserving
// the v1 publication pointer. No archive state exists in the current schema.
const TEST_PROJECTION = `
  SELECT t.id, tv.title,
         CASE WHEN tv.published_at IS NULL THEN 'draft' ELSE 'published' END AS status,
         t.current_version_id, GREATEST(t.updated_at, tv.created_at) AS updated_at,
         tv.id AS version_id, tv.duration_seconds
    FROM test t
    JOIN LATERAL (
      SELECT id, title, published_at, created_at, duration_seconds
        FROM test_version WHERE test_id = t.id ORDER BY version DESC LIMIT 1
    ) tv ON true
`

function toTestSummary(row: TestDbRow): AdminTestSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    currentVersionId: row.current_version_id,
    updatedAt: row.updated_at.toISOString(),
  }
}

/** A single statement gives the global counters one consistent snapshot. */
export async function loadAdminOverview(
  db: PgQueryable,
  input: Record<string, never>,
): Promise<AdminOverview> {
  void input
  const { rows } = await db.query<{
    tests: AdminOverview["tests"]
    attempts: AdminOverview["attempts"]
    learners: AdminOverview["learners"]
  }>(`
    SELECT (
      SELECT jsonb_build_object('total', count(*),
        'drafts', count(*) FILTER (WHERE latest.published_at IS NULL),
        'published', count(*) FILTER (WHERE latest.published_at IS NOT NULL))
        FROM test t LEFT JOIN LATERAL (
          SELECT published_at FROM test_version
           WHERE test_id = t.id ORDER BY version DESC LIMIT 1
        ) latest ON true
    ) AS tests, (
      SELECT jsonb_build_object('total', count(*),
        'inProgress', count(*) FILTER (WHERE status = 'in_progress'),
        'completed', count(*) FILTER (WHERE status <> 'in_progress')) FROM attempt
    ) AS attempts, (
      SELECT jsonb_build_object('total', count(*)) FROM student
    ) AS learners
  `)

  return rows[0]
}

export async function listAdminTests(
  db: PgQueryable,
  query: AdminPagination & AdminTestFilter,
): Promise<AdminTestPage> {
  const cursor = decodeCursor(query, "tests")
  const { rows } = await db.query<TestDbRow>(
    `
    WITH tests AS (${TEST_PROJECTION})
    SELECT * FROM tests
     WHERE ($1::text IS NULL OR status = $1)
       AND ($2::text IS NULL OR title ILIKE '%' || $2 || '%')
       AND ($3::text IS NULL OR (title, id) > ($3, $4::uuid))
     ORDER BY title, id LIMIT $5
  `,
    [
      query.status ?? null,
      query.search ?? null,
      cursor?.key ?? null,
      cursor?.id ?? null,
      query.limit + 1,
    ],
  )
  const items = rows.slice(0, query.limit).map(toTestSummary)
  const last = items[items.length - 1]

  return {
    items,
    nextCursor:
      rows.length > query.limit
        ? encodeCursor("tests", last.title, last.id)
        : null,
  }
}

export async function loadAdminTestDetail(
  db: PgQueryable,
  testId: string,
): Promise<AdminTestDetail | null> {
  const { rows } = await db.query<
    TestDbRow & { sections: AdminTestDetail["sections"] }
  >(
    `
    WITH selected AS (${TEST_PROJECTION} WHERE t.id = $1)
    SELECT selected.*, COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', section.id, 'title', section.title,
        'questionCount', section.question_count) ORDER BY section.ordinal)
        FROM (
          SELECT ts.id, ts.title, ts.ordinal, count(q.id) AS question_count
            FROM test_section ts
            LEFT JOIN question_group qg ON qg.test_section_id = ts.id
            LEFT JOIN question q ON q.question_group_id = qg.id
           WHERE ts.test_version_id = selected.version_id
           GROUP BY ts.id, ts.title, ts.ordinal
        ) section
    ), '[]'::jsonb) AS sections FROM selected
  `,
    [testId],
  )

  if (rows.length === 0) {
    return null
  }

  const [row] = rows

  return {
    ...toTestSummary(row),
    description: null,
    durationSeconds: row.duration_seconds,
    sections: row.sections,
  }
}

interface ResultDbRow {
  attempt_id: string
  test_id: string
  test_title: string
  learner_id: string
  learner_name: string
  points_earned: number
  points_possible: number
  submitted_at: Date
  cursor_submitted_at: string
  test_version_id: string
}

// Intentionally selects only the finalized score cache and identity. It never
// joins responses, choices, or a student-owned result/review projection.
const RESULT_PROJECTION = `
  SELECT a.id AS attempt_id, tv.test_id, tv.title AS test_title,
         s.id AS learner_id, s.display_name AS learner_name,
         a.points_earned, a.points_possible, a.submitted_at,
         a.submitted_at::text AS cursor_submitted_at, a.test_version_id
    FROM attempt a
    JOIN test_version tv ON tv.id = a.test_version_id
    JOIN student s ON s.id = a.student_id
   WHERE a.status <> 'in_progress'
`

function toResultSummary(row: ResultDbRow): AdminResultSummary {
  return {
    attemptId: row.attempt_id,
    testId: row.test_id,
    testTitle: row.test_title,
    learnerId: row.learner_id,
    learnerName: row.learner_name,
    score: row.points_earned,
    maxScore: row.points_possible,
    completedAt: row.submitted_at.toISOString(),
  }
}

export async function listAdminResults(
  db: PgQueryable,
  query: AdminPagination & { testId?: string; learnerId?: string },
): Promise<AdminResultPage> {
  const cursor = decodeCursor(query, "results")
  const { rows } = await db.query<ResultDbRow>(
    `
    ${RESULT_PROJECTION}
      AND ($1::uuid IS NULL OR tv.test_id = $1)
      AND ($2::uuid IS NULL OR a.student_id = $2)
      AND ($3::timestamptz IS NULL OR a.submitted_at < $3
        OR (a.submitted_at = $3 AND a.id > $4::uuid))
    ORDER BY a.submitted_at DESC, a.id ASC LIMIT $5
  `,
    [
      query.testId ?? null,
      query.learnerId ?? null,
      cursor?.key ?? null,
      cursor?.id ?? null,
      query.limit + 1,
    ],
  )
  const pageRows = rows.slice(0, query.limit)
  const last = pageRows[pageRows.length - 1]

  return {
    items: pageRows.map(toResultSummary),
    nextCursor:
      rows.length > query.limit
        ? encodeCursor("results", last.cursor_submitted_at, last.attempt_id)
        : null,
  }
}

interface AnswerDbRow {
  id: string
  ordinal: number
  type: QuestionType
  section_id: string
  points: number
  choices: Array<{ id: string; label: string; isCorrect: boolean }>
  selected_choice_ids: string[]
}

function toAnswer(row: AnswerDbRow): AdminAttemptDetail["answers"][number] {
  const selected = row.selected_choice_ids.map(asChoiceId)
  const correct =
    selected.length > 0 &&
    isQuestionCorrect(
      {
        id: asQuestionId(row.id),
        ordinal: row.ordinal,
        type: row.type,
        sectionId: asSectionId(row.section_id),
        points: row.points,
        prompt: "",
        choices: row.choices.map((choice) => ({
          ...choice,
          id: asChoiceId(choice.id),
        })),
      },
      selected,
    )

  return {
    questionId: row.id,
    response: { selectedChoiceIds: row.selected_choice_ids },
    score: correct ? row.points : 0,
    maxScore: row.points,
  }
}

/** The sole read here that retrieves answer data, always for a finished attempt. */
export async function loadAdminAttemptDetail(
  db: PgQueryable,
  attemptId: string,
): Promise<AdminAttemptDetail | null> {
  const { rows } = await db.query<ResultDbRow>(
    `${RESULT_PROJECTION} AND a.id = $1`,
    [attemptId],
  )

  if (rows.length === 0) {
    return null
  }

  const [result] = rows

  const answers = await db.query<AnswerDbRow>(
    `
    SELECT q.id, q.ordinal, q.type, qg.test_section_id AS section_id, q.points,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label,
             'isCorrect', c.is_correct) ORDER BY c.ordinal) FROM choice c WHERE c.question_id = q.id), '[]'::jsonb) AS choices,
           ARRAY(SELECT rc.choice_id FROM response_choice rc
             JOIN choice c ON c.id = rc.choice_id
             WHERE rc.attempt_id = $1 AND rc.question_id = q.id
             ORDER BY c.ordinal) AS selected_choice_ids
      FROM question q
      JOIN question_group qg ON qg.id = q.question_group_id
      JOIN test_section ts ON ts.id = qg.test_section_id
     WHERE q.test_version_id = $2
     ORDER BY ts.ordinal, qg.ordinal, q.ordinal
  `,
    [attemptId, result.test_version_id],
  )

  return { ...toResultSummary(result), answers: answers.rows.map(toAnswer) }
}

interface LearnerDbRow {
  id: string
  display_name: string
  email: string
  attempt_count: string
  last_attempt_at: Date | null
}

export async function listAdminLearners(
  db: PgQueryable,
  query: AdminPagination & { search?: string },
): Promise<AdminLearnerPage> {
  const cursor = decodeCursor(query, "learners")
  const { rows } = await db.query<LearnerDbRow>(
    `
    WITH page AS (
      SELECT id, display_name, email FROM student
       WHERE ($1::text IS NULL OR display_name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
         AND ($2::text IS NULL OR (display_name, id) > ($2, $3::uuid))
       ORDER BY display_name, id LIMIT $4
    )
    SELECT page.*, activity.attempt_count, activity.last_attempt_at
      FROM page LEFT JOIN LATERAL (
        SELECT count(*) AS attempt_count, max(created_at) AS last_attempt_at
          FROM attempt WHERE student_id = page.id
      ) activity ON true
     ORDER BY page.display_name, page.id
  `,
    [
      query.search ?? null,
      cursor?.key ?? null,
      cursor?.id ?? null,
      query.limit + 1,
    ],
  )
  const pageRows = rows.slice(0, query.limit)
  const last = pageRows[pageRows.length - 1]

  return {
    items: pageRows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      email: row.email,
      attemptCount: Number(row.attempt_count),
      lastAttemptAt: row.last_attempt_at?.toISOString() ?? null,
    })),
    nextCursor:
      rows.length > query.limit
        ? encodeCursor("learners", last.display_name, last.id)
        : null,
  }
}
