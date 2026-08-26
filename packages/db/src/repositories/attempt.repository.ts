import { asChoiceId, asQuestionId } from "@pp/common"
import { scoreAttempt, type RecordedAnswer } from "@pp/common/scoring"
import { withTransaction, type PgQueryable } from "@liam-public/node-postgres"
import type pg from "pg"
import { loadForScoring } from "../scoring.js"

export interface AttemptRow {
  id: string
  studentId: string
  testVersionId: string
  status: "in_progress" | "submitted" | "expired"
  startedAt: Date | null
  expiresAt: Date | null
  currentSectionId: string | null
  currentQuestionId: string | null
}

interface AttemptDbRow {
  id: string
  student_id: string
  test_version_id: string
  status: "in_progress" | "submitted" | "expired"
  started_at: Date | null
  expires_at: Date | null
  current_section_id: string | null
  current_question_id: string | null
}

function toAttempt(row: AttemptDbRow): AttemptRow {
  return {
    id: row.id,
    studentId: row.student_id,
    testVersionId: row.test_version_id,
    status: row.status,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    currentSectionId: row.current_section_id,
    currentQuestionId: row.current_question_id,
  }
}

const ATTEMPT_COLUMNS = `id, student_id, test_version_id, status, started_at,
                          expires_at, current_section_id, current_question_id`

/**
 * Scoped by BOTH id and studentId — a mismatch and a nonexistent id are
 * indistinguishable to the caller, which is what makes 403 (not 404) safe.
 */
export async function loadOwnedAttempt(
  db: PgQueryable,
  input: { attemptId: string; studentId: string },
): Promise<AttemptRow | null> {
  const { rows } = await db.query<AttemptDbRow>(
    `SELECT ${ATTEMPT_COLUMNS} FROM attempt WHERE id = $1 AND student_id = $2`,
    [input.attemptId, input.studentId],
  )

  if (rows.length === 0) {
    return null
  }

  const [row] = rows

  return toAttempt(row)
}

export interface FinalizedAttemptRow {
  id: string
  status: "expired"
  submittedAt: Date
}

interface AttemptStatusRow {
  status: string
  submitted_at: Date | null
  test_version_id: string
  expires_at: Date | null
}

interface AnswerRow {
  question_id: string
  choice_ids: string[]
}

/**
 * Idempotent: if `attempt.status` is already terminal, returns the
 * existing row without re-grading (re-running scoreAttempt on the same
 * frozen content and responses would be safe but wasteful, and a second
 * write past a CHECK-satisfied row is pure risk for no benefit).
 */
export async function finalizeExpiredAttempt(
  db: PgQueryable,
  input: { attemptId: string; now: Date },
): Promise<FinalizedAttemptRow> {
  const { rows: existing } = await db.query<AttemptStatusRow>(
    `SELECT status, submitted_at, test_version_id, expires_at
       FROM attempt WHERE id = $1`,
    [input.attemptId],
  )

  if (existing.length === 0) {
    // `rows[0]` types as non-undefined because noUncheckedIndexedAccess is off,
    // so without this an unknown id dies on a TypeError several lines later
    // instead of saying what went wrong.
    throw new Error(`attempt ${input.attemptId} does not exist`)
  }

  const [attempt] = existing

  if (attempt.status !== "in_progress") {
    // Already terminal — including the ordinary 'submitted' path, which
    // phase 5 owns. Reported back as 'expired' regardless, matching
    // FinalizedAttemptRow's fixed status; this endpoint's callers only ever
    // reach here through the expiry check, never through a real submit.
    const submittedAt = attempt.submitted_at ?? attempt.expires_at

    if (!submittedAt) {
      // `attempt_finished_is_graded` guarantees submitted_at is set once
      // status leaves 'in_progress'; this is unreachable in practice and
      // exists only so the return type below stays non-null without a
      // non-null assertion.
      throw new Error(
        `attempt ${input.attemptId} is terminal but has no submitted_at or expires_at`,
      )
    }

    return {
      id: input.attemptId,
      status: "expired",
      submittedAt,
    }
  }

  const questions = await loadForScoring(db as pg.Pool, attempt.test_version_id)
  const { rows: answerRows } = await db.query<AnswerRow>(
    `SELECT r.question_id,
            COALESCE(array_agg(rc.choice_id) FILTER (WHERE rc.choice_id IS NOT NULL), '{}') AS choice_ids
       FROM response r
       LEFT JOIN response_choice rc
         ON rc.attempt_id = r.attempt_id AND rc.question_id = r.question_id
      WHERE r.attempt_id = $1
      GROUP BY r.question_id`,
    [input.attemptId],
  )
  const answers: RecordedAnswer[] = answerRows.map((r) => ({
    questionId: asQuestionId(r.question_id),
    selectedChoiceIds: r.choice_ids.map(asChoiceId),
  }))
  const score = scoreAttempt(questions, answers)

  const { rows } = await db.query<{ submitted_at: Date }>(
    `UPDATE attempt
        SET status = 'expired', submitted_at = expires_at,
            points_earned = $2, points_possible = $3, percentage = $4,
            answered_count = $5, unanswered_count = $6,
            correct_count = $7, incorrect_count = $8, question_count = $9
      WHERE id = $1 AND status = 'in_progress'
      RETURNING submitted_at`,
    [
      input.attemptId,
      score.pointsEarned,
      score.pointsPossible,
      score.percentage,
      score.answeredCount,
      score.unansweredCount,
      score.correctCount,
      score.incorrectCount,
      score.questionCount,
    ],
  )

  if (rows.length === 0) {
    // Another request finalized this attempt between our SELECT and this
    // UPDATE. The status predicate above is what makes that a no-op rather
    // than a second grade; re-read to report what actually landed, so two
    // racing callers agree on submitted_at.
    return finalizeExpiredAttempt(db, input)
  }

  const [row] = rows

  return {
    id: input.attemptId,
    status: "expired",
    submittedAt: row.submitted_at,
  }
}

/**
 * The load-bearing check every attempt-scoped route runs first. Returns
 * the live row when the attempt is still running; finalizes and returns
 * null when it is not, so the caller's only job is `if (!row) throw 410`.
 */
export async function loadRunningOwnedAttempt(
  db: PgQueryable,
  input: { attemptId: string; studentId: string; now: Date },
): Promise<
  | { attempt: AttemptRow; finalized: null }
  | { attempt: null; finalized: FinalizedAttemptRow | null }
> {
  const attempt = await loadOwnedAttempt(db, input)

  if (!attempt) {
    return { attempt: null, finalized: null }
  }

  if (
    attempt.status === "in_progress" &&
    (!attempt.expiresAt || attempt.expiresAt > input.now)
  ) {
    return { attempt, finalized: null }
  }

  const finalized = await finalizeExpiredAttempt(db, {
    attemptId: attempt.id,
    now: input.now,
  })

  return { attempt: null, finalized }
}

/** Thrown when a slug has no published version -- the caller maps this to 404. */
export class TestNotFoundError extends Error {}

export interface StartResult {
  attempt: {
    id: string
    attemptNumber: number
    createdAt: Date
    startedAt: Date | null
    expiresAt: Date | null
    currentSectionId: string | null
    currentQuestionId: string | null
  }
  resumed: boolean
  finalizedPriorAttempt: { id: string; submittedAt: Date } | null
}

interface AttemptStartRow {
  id: string
  created_at: Date
  started_at: Date | null
  expires_at: Date | null
  current_section_id: string | null
  current_question_id: string | null
}

function toStartAttempt(
  row: AttemptStartRow,
  attemptNumber: number,
): StartResult["attempt"] {
  return {
    id: row.id,
    attemptNumber,
    createdAt: row.created_at,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    currentSectionId: row.current_section_id,
    currentQuestionId: row.current_question_id,
  }
}

async function countAttempts(
  db: PgQueryable,
  input: { studentId: string; versionId: string },
): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*) AS count FROM attempt WHERE student_id = $1 AND test_version_id = $2`,
    [input.studentId, input.versionId],
  )
  const [row] = rows

  return Number(row.count)
}

/**
 * One endpoint, three behaviours (spec §4): resume a live attempt,
 * finalize a stale one and start fresh in its place, or start fresh with
 * nothing to replace. The finalize-then-create step runs in one
 * transaction with the read that decided it needed to happen: splitting
 * them would leave a window with no in-progress attempt for this
 * (student, version), and a concurrent Start could create a second new
 * attempt in that gap. `attempt_one_active` (a partial unique index on
 * `status = 'in_progress'`) is the backstop the controller relies on for
 * the remaining race -- two callers reaching this function at once.
 */
export async function startOrResumeAttempt(
  db: PgQueryable,
  input: { studentId: string; slug: string; now: Date },
): Promise<StartResult> {
  const { rows: versionRows } = await db.query<{ version_id: string }>(
    `SELECT tv.id AS version_id
       FROM test t
       JOIN test_version tv ON tv.id = t.current_version_id AND tv.published_at IS NOT NULL
      WHERE t.slug = $1`,
    [input.slug],
  )

  if (versionRows.length === 0) {
    throw new TestNotFoundError(input.slug)
  }

  const [{ version_id: versionId }] = versionRows

  return withTransaction(db as pg.Pool, (tx) =>
    startOrResumeInTransaction(tx, {
      studentId: input.studentId,
      versionId,
      now: input.now,
    }),
  )
}

async function startOrResumeInTransaction(
  tx: PgQueryable,
  input: { studentId: string; versionId: string; now: Date },
): Promise<StartResult> {
  const { rows: activeRows } = await tx.query<AttemptStartRow>(
    `SELECT id, created_at, started_at, expires_at, current_section_id, current_question_id
       FROM attempt
      WHERE student_id = $1 AND test_version_id = $2 AND status = 'in_progress'`,
    [input.studentId, input.versionId],
  )

  // Rule 2: `expires_at IS NULL` means untimed, not expired -- an attempt
  // created but never entered has no deadline yet and must resume rather
  // than be finalized.
  if (activeRows.length > 0) {
    const [active] = activeRows

    if (!active.expires_at || active.expires_at > input.now) {
      const attemptNumber = await countAttempts(tx, input)

      return {
        attempt: toStartAttempt(active, attemptNumber),
        resumed: true,
        finalizedPriorAttempt: null,
      }
    }

    const finalized = await finalizeExpiredAttempt(tx, {
      attemptId: active.id,
      now: input.now,
    })

    return createAttempt(tx, input, {
      id: finalized.id,
      submittedAt: finalized.submittedAt,
    })
  }

  return createAttempt(tx, input, null)
}

async function createAttempt(
  tx: PgQueryable,
  input: { studentId: string; versionId: string },
  finalizedPriorAttempt: { id: string; submittedAt: Date } | null,
): Promise<StartResult> {
  const { rows: created } = await tx.query<AttemptStartRow>(
    `INSERT INTO attempt (student_id, test_version_id, status)
     VALUES ($1, $2, 'in_progress')
     RETURNING id, created_at, started_at, expires_at, current_section_id, current_question_id`,
    [input.studentId, input.versionId],
  )
  const [row] = created
  const attemptNumber = await countAttempts(tx, input)

  return {
    attempt: toStartAttempt(row, attemptNumber),
    resumed: false,
    finalizedPriorAttempt,
  }
}
