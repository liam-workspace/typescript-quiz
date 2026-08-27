import {
  asChoiceId,
  asQuestionId,
  asSectionId,
  canSetPosition,
  gradeAttempt,
  isPastDeadline,
  type GradableResponse,
  type GradableSection,
  type SectionScore,
} from "@pp/common"
import {
  withTransaction,
  type PgPool,
  type PgQueryable,
} from "@liam-public/node-postgres"
import type pg from "pg"
import { loadForScoring } from "../scoring.js"
import { SectionExpiredError } from "./section-expired.error.js"

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

/**
 * Idempotent: if `attempt.status` is already terminal, returns the
 * existing row without re-grading. The actual grading + write lives in
 * exactly one place -- finalizeAttemptTx below -- so an expired attempt and
 * a submitted one can never disagree about what score the SAME responses
 * over the SAME frozen content produce. The one genuine difference between
 * the two is what submittedAt gets pinned to (the deadline, never `now`),
 * which is why it is resolved here and handed in rather than being decided
 * by finalizeAttemptTx itself.
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

  if (!attempt.expires_at) {
    // The clock-paired constraint plus the caller contract
    // (loadRunningOwnedAttempt only reaches here once isPastDeadline has
    // already required a non-null expiresAt) make this unreachable in
    // practice; guarded so the pin below never silently degrades to
    // `undefined`.
    throw new Error(
      `attempt ${input.attemptId} is in_progress with no deadline to expire at`,
    )
  }

  const graded = await finalizeAttemptTx(db, {
    attemptId: input.attemptId,
    status: "expired",
    // An expired attempt is finalized AT its deadline, never at the moment
    // the late request happened to arrive -- attempt_expired_pins_deadline
    // enforces exactly this at the database.
    submittedAt: attempt.expires_at,
  })

  if (!graded) {
    // Vanished between our SELECT above and finalizeAttemptTx's own --
    // attempt rows are never deleted (test_version_id is ON DELETE
    // RESTRICT), so this is practically unreachable; kept so the return
    // type stays honest without a non-null assertion.
    throw new Error(`attempt ${input.attemptId} does not exist`)
  }

  return {
    id: input.attemptId,
    status: "expired",
    submittedAt: graded.submittedAt,
  }
}

export interface AttemptScoreRow {
  attemptId: string
  testVersionId: string
  status: "submitted" | "expired"
  submittedAt: Date
  pointsEarned: number
  pointsPossible: number
  percentage: number
  answered: number
  unanswered: number
  correct: number
  incorrect: number
  sections: SectionScore[]
}

interface AttemptFinalizeStateRow {
  status: "in_progress" | "submitted" | "expired"
  test_version_id: string
  submitted_at: Date | null
  points_earned: number | null
  points_possible: number | null
  percentage: string | null
  answered_count: number | null
  unanswered_count: number | null
  correct_count: number | null
  incorrect_count: number | null
  question_count: number | null
}

interface TestSectionGradeRow {
  id: string
  title: string
  type: string
}

async function loadGradableSections(
  tx: PgQueryable,
  testVersionId: string,
): Promise<GradableSection[]> {
  const { rows } = await tx.query<TestSectionGradeRow>(
    `SELECT id, title, type::text AS type
       FROM test_section
      WHERE test_version_id = $1
      ORDER BY ordinal`,
    [testVersionId],
  )

  return rows.map((r) => ({
    id: asSectionId(r.id),
    title: r.title,
    type: r.type as GradableSection["type"],
  }))
}

interface ResponseGradeRow {
  question_id: string
  choice_ids: string[]
}

async function loadResponsesForGrading(
  tx: PgQueryable,
  attemptId: string,
): Promise<GradableResponse[]> {
  const { rows } = await tx.query<ResponseGradeRow>(
    `SELECT r.question_id,
            COALESCE(array_agg(rc.choice_id) FILTER (WHERE rc.choice_id IS NOT NULL), '{}') AS choice_ids
       FROM response r
       LEFT JOIN response_choice rc
         ON rc.attempt_id = r.attempt_id AND rc.question_id = r.question_id
      WHERE r.attempt_id = $1
      GROUP BY r.question_id`,
    [attemptId],
  )

  return rows.map((r) => ({
    questionId: asQuestionId(r.question_id),
    selectedChoiceIds: r.choice_ids.map(asChoiceId),
  }))
}

/**
 * The ONE place an attempt is graded and its nine score columns are
 * written. Not exported from the package (see index.ts) -- reachable only
 * by this module's own finalizeAttempt/finalizeExpiredAttempt, and by
 * attempt-finalize.test.ts via a relative import. Task 6's submit handler
 * is the intended external caller once it exists: it applies the final
 * responses and finalizes in the SAME transaction, which is exactly why
 * this takes an already-open `tx` instead of opening its own.
 *
 * Locks the row FOR UPDATE first: called through finalizeAttempt (a real
 * transaction), that lock alone serializes concurrent finalizers, so the
 * second caller simply observes the row as already terminal. Called with a
 * bare pool (as finalizeExpiredAttempt sometimes is), FOR UPDATE does not
 * persist across separate round trips -- so the terminal write below is
 * ALSO guarded by `WHERE status = 'in_progress'` and re-reads on conflict,
 * the same belt-and-suspenders pattern claimPlay uses. Either way, exactly
 * one write ever lands.
 */
export async function finalizeAttemptTx(
  tx: PgQueryable,
  input: {
    attemptId: string
    status: "submitted" | "expired"
    submittedAt: Date
  },
): Promise<AttemptScoreRow | null> {
  const { rows } = await tx.query<AttemptFinalizeStateRow>(
    `SELECT status, test_version_id, submitted_at,
            points_earned, points_possible, percentage,
            answered_count, unanswered_count, correct_count, incorrect_count,
            question_count
       FROM attempt
      WHERE id = $1
      FOR UPDATE`,
    [input.attemptId],
  )

  if (rows.length === 0) {
    return null
  }

  const [attempt] = rows

  // `sections` is never cached on `attempt` -- only the flat totals are
  // (see the schema comment on attempt.points_earned). Every reader of a
  // score's per-section breakdown, fresh or already-finalized, recomputes
  // it here from frozen content. That recompute never feeds back into a
  // write and content is immutable once published, so it reproduces
  // exactly the numbers whichever call originally froze the flat totals
  // below -- it is not the re-grade the idempotence contract forbids.
  const sections = await loadGradableSections(tx, attempt.test_version_id)
  const questions = await loadForScoring(tx, attempt.test_version_id)
  const responses = await loadResponsesForGrading(tx, input.attemptId)
  const graded = gradeAttempt({ sections, questions, responses })

  if (attempt.status !== "in_progress") {
    // Already terminal -- NOT a re-grade. The flat totals are read back
    // exactly as a prior call froze them; input.status/input.submittedAt
    // are ignored on purpose (attempt-finalize.test.ts proves this with a
    // second call that passes DIFFERENT values and asserts nothing moved).
    if (
      attempt.submitted_at === null ||
      attempt.points_earned === null ||
      attempt.points_possible === null ||
      attempt.percentage === null ||
      attempt.answered_count === null ||
      attempt.unanswered_count === null ||
      attempt.correct_count === null ||
      attempt.incorrect_count === null
    ) {
      // `attempt_finished_is_graded` guarantees every one of these is
      // non-null once status leaves 'in_progress' -- unreachable in
      // practice, guarded so the return below stays honest without a
      // non-null assertion.
      throw new Error(
        `attempt ${input.attemptId} is terminal but missing a graded column`,
      )
    }

    return {
      attemptId: input.attemptId,
      testVersionId: attempt.test_version_id,
      status: attempt.status,
      submittedAt: attempt.submitted_at,
      pointsEarned: attempt.points_earned,
      pointsPossible: attempt.points_possible,
      percentage: Number(attempt.percentage),
      answered: attempt.answered_count,
      unanswered: attempt.unanswered_count,
      correct: attempt.correct_count,
      incorrect: attempt.incorrect_count,
      sections: graded.sections,
    }
  }

  // For 'expired', submitted_at is pinned to the expires_at COLUMN, not the
  // $3 parameter -- a JS Date only holds millisecond precision, while
  // expires_at (often derived from `now()`) can carry microseconds, so
  // round-tripping it through JS and back would fail
  // attempt_expired_pins_deadline's exact-equality check by a few
  // microseconds. Reading straight from the column sidesteps that.
  const { rows: written } = await tx.query<{ submitted_at: Date }>(
    `UPDATE attempt
        SET status = $2,
            submitted_at = CASE WHEN $2::attempt_status = 'expired' THEN expires_at ELSE $3 END,
            points_earned = $4, points_possible = $5, percentage = $6,
            answered_count = $7, unanswered_count = $8,
            correct_count = $9, incorrect_count = $10, question_count = $11
      WHERE id = $1 AND status = 'in_progress'
      RETURNING submitted_at`,
    [
      input.attemptId,
      input.status,
      input.submittedAt,
      graded.pointsEarned,
      graded.pointsPossible,
      graded.percentage,
      graded.answered,
      graded.unanswered,
      graded.correct,
      graded.incorrect,
      questions.length,
    ],
  )

  if (written.length === 0) {
    // Lost a race between our SELECT and this UPDATE -- another caller
    // finalized first. Re-read and return THEIR row, not ours, so two
    // racing callers agree on the result.
    return finalizeAttemptTx(tx, input)
  }

  const [row] = written

  return {
    attemptId: input.attemptId,
    testVersionId: attempt.test_version_id,
    status: input.status,
    submittedAt: row.submitted_at,
    pointsEarned: graded.pointsEarned,
    pointsPossible: graded.pointsPossible,
    percentage: graded.percentage,
    answered: graded.answered,
    unanswered: graded.unanswered,
    correct: graded.correct,
    incorrect: graded.incorrect,
    sections: graded.sections,
  }
}

/**
 * The pool-opening entry point for grading + finalizing an attempt outside
 * any existing transaction -- what Tasks 7-8's lazy finalize call. Never
 * re-grades: see finalizeAttemptTx, the single place this and
 * finalizeExpiredAttempt both delegate the actual work to.
 */
export function finalizeAttempt(
  pool: PgPool,
  input: {
    attemptId: string
    status: "submitted" | "expired"
    submittedAt: Date
  },
): Promise<AttemptScoreRow | null> {
  return withTransaction(pool, (tx) => finalizeAttemptTx(tx, input))
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
    !isPastDeadline(attempt.expiresAt, input.now)
  ) {
    return { attempt, finalized: null }
  }

  const finalized = await finalizeExpiredAttempt(db, {
    attemptId: attempt.id,
    now: input.now,
  })

  return { attempt: null, finalized }
}

interface PositionContextDbRow {
  navigation: "free" | "forward_only"
  target_ordinal: number
  current_ordinal: number | null
  section_expires_at: Date
}

/**
 * Persists the runner's singleton position. The attempt row is locked while
 * the navigation decision is made so two debounced writes cannot both read
 * the same old question and let the later write move a forward-only section
 * backward.
 */
export async function setPosition(
  db: PgQueryable,
  input: {
    attemptId: string
    sectionId: string
    questionId: string
    now: Date
  },
): Promise<{ ok: true } | { ok: false; reason: "navigation_locked" }> {
  const result = await withTransaction(db as pg.Pool, (tx) =>
    setPositionInTransaction(tx, input),
  )

  return result
}

async function setPositionInTransaction(
  tx: PgQueryable,
  input: {
    attemptId: string
    sectionId: string
    questionId: string
    now: Date
  },
): Promise<{ ok: true } | { ok: false; reason: "navigation_locked" }> {
  const { rows } = await tx.query<PositionContextDbRow>(
    `SELECT ts.navigation,
            target.ordinal AS target_ordinal,
            current.ordinal AS current_ordinal,
            position_section.expires_at AS section_expires_at
       FROM attempt a
       JOIN test_section ts
         ON ts.id = $2 AND ts.test_version_id = a.test_version_id
       JOIN attempt_section position_section
         ON position_section.attempt_id = a.id
        AND position_section.test_section_id = ts.id
        AND position_section.completed_at IS NULL
       JOIN question target
         ON target.id = $3 AND target.test_version_id = a.test_version_id
       JOIN question_group target_group
         ON target_group.id = target.question_group_id
        AND target_group.test_section_id = ts.id
       LEFT JOIN question current
         ON current.id = a.current_question_id
        AND current.test_version_id = a.test_version_id
      WHERE a.id = $1
      FOR UPDATE OF a`,
    [input.attemptId, input.sectionId, input.questionId],
  )

  if (rows.length === 0) {
    throw new Error(
      `position ${input.sectionId}/${input.questionId} is not valid for attempt ${input.attemptId}`,
    )
  }

  const [context] = rows

  if (isPastDeadline(context.section_expires_at, input.now)) {
    throw new SectionExpiredError()
  }

  if (
    !canSetPosition(
      context.navigation,
      context.current_ordinal,
      context.target_ordinal,
    )
  ) {
    return { ok: false, reason: "navigation_locked" }
  }

  await tx.query(
    `UPDATE attempt
        SET current_section_id = $2, current_question_id = $3
      WHERE id = $1`,
    [input.attemptId, input.sectionId, input.questionId],
  )

  return { ok: true }
}

export interface SectionEntryRow {
  sectionId: string
  enteredAt: Date
  expiresAt: Date
  /** Present only on the FIRST section entry of this attempt -- see enterSection. */
  attemptStartedAt: Date | null
  attemptExpiresAt: Date | null
}

interface OpenAttemptSectionDbRow {
  test_section_id: string
  entered_at: Date
  expires_at: Date
}

interface EnterSectionContextDbRow {
  started_at: Date | null
  section_duration_seconds: number
  test_version_id: string
  version_duration_seconds: number
}

/**
 * "I'm ready" for one section (spec: this is where the clock starts --
 * reading the brief and the section rules is untimed). Wrapped in a single
 * transaction because `attempt_clock_paired` (started_at IS NULL) =
 * (expires_at IS NULL) rejects setting one half without the other, and the
 * first-entry branch below writes both attempt.started_at and
 * attempt.expires_at together.
 *
 * Rule, in order:
 *   1. An OPEN attempt_section already exists for this exact section --
 *      idempotent success, the ORIGINAL entered_at/expires_at come back
 *      unchanged (a refresh must not extend or reset the deadline).
 *   2. A DIFFERENT attempt_section is open -- refused; closing a section is
 *      a side effect of the answer-submission path, not of entering another.
 *   3. Otherwise this is a genuine new entry: insert attempt_section, and if
 *      this is the attempt's first-ever section entry, also start the
 *      whole-test clock and seed current_section_id/current_question_id --
 *      done on every entry (not only the first) so a reload lands correctly
 *      mid-section.
 */
export function enterSection(
  db: PgQueryable,
  input: { attemptId: string; sectionId: string; now: Date },
): Promise<
  | { ok: true; entry: SectionEntryRow }
  | { ok: false; reason: "section_still_open" }
> {
  return withTransaction(db as pg.Pool, (tx) =>
    enterSectionInTransaction(tx, input),
  )
}

async function enterSectionInTransaction(
  tx: PgQueryable,
  input: { attemptId: string; sectionId: string; now: Date },
): Promise<
  | { ok: true; entry: SectionEntryRow }
  | { ok: false; reason: "section_still_open" }
> {
  const { rows: openRows } = await tx.query<OpenAttemptSectionDbRow>(
    `SELECT test_section_id, entered_at, expires_at
       FROM attempt_section
      WHERE attempt_id = $1 AND completed_at IS NULL
      FOR UPDATE`,
    [input.attemptId],
  )

  const sameSection = openRows.find(
    (row) => row.test_section_id === input.sectionId,
  )

  if (sameSection) {
    return {
      ok: true,
      entry: {
        sectionId: input.sectionId,
        enteredAt: sameSection.entered_at,
        expiresAt: sameSection.expires_at,
        // Not the first entry -- an open row for THIS section already
        // existing means the attempt's clock was already started earlier.
        attemptStartedAt: null,
        attemptExpiresAt: null,
      },
    }
  }

  if (openRows.length > 0) {
    return { ok: false, reason: "section_still_open" }
  }

  const { rows: contextRows } = await tx.query<EnterSectionContextDbRow>(
    `SELECT a.started_at,
            ts.duration_seconds AS section_duration_seconds,
            ts.test_version_id,
            tv.duration_seconds AS version_duration_seconds
       FROM attempt a
       JOIN test_section ts ON ts.id = $2
       JOIN test_version tv ON tv.id = ts.test_version_id
      WHERE a.id = $1
      FOR UPDATE OF a`,
    [input.attemptId, input.sectionId],
  )

  if (contextRows.length === 0) {
    throw new Error(
      `section ${input.sectionId} does not belong to the test version of attempt ${input.attemptId}`,
    )
  }

  const [context] = contextRows
  const sectionExpiresAt = new Date(
    input.now.getTime() + context.section_duration_seconds * 1000,
  )

  const { rows: insertedRows } = await tx.query<{
    entered_at: Date
    expires_at: Date
  }>(
    `INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id, entered_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING entered_at, expires_at`,
    [
      input.attemptId,
      input.sectionId,
      context.test_version_id,
      input.now,
      sectionExpiresAt,
    ],
  )
  const [inserted] = insertedRows

  const { rows: questionRows } = await tx.query<{ id: string }>(
    `SELECT q.id
       FROM question q
       JOIN question_group qg ON q.question_group_id = qg.id
      WHERE qg.test_section_id = $1
      ORDER BY q.ordinal ASC
      LIMIT 1`,
    [input.sectionId],
  )
  const firstQuestionId = questionRows[0]?.id ?? null

  const isFirstSectionEntry = context.started_at === null

  if (!isFirstSectionEntry) {
    await tx.query(
      `UPDATE attempt
          SET current_section_id = $2, current_question_id = $3
        WHERE id = $1`,
      [input.attemptId, input.sectionId, firstQuestionId],
    )

    return {
      ok: true,
      entry: {
        sectionId: input.sectionId,
        enteredAt: inserted.entered_at,
        expiresAt: inserted.expires_at,
        attemptStartedAt: null,
        attemptExpiresAt: null,
      },
    }
  }

  const attemptExpiresAt = new Date(
    input.now.getTime() + context.version_duration_seconds * 1000,
  )

  const { rows: attemptRows } = await tx.query<{
    started_at: Date
    expires_at: Date
  }>(
    `UPDATE attempt
        SET started_at = $2, expires_at = $3,
            current_section_id = $4, current_question_id = $5
      WHERE id = $1
      RETURNING started_at, expires_at`,
    [
      input.attemptId,
      input.now,
      attemptExpiresAt,
      input.sectionId,
      firstQuestionId,
    ],
  )
  const [updatedAttempt] = attemptRows

  return {
    ok: true,
    entry: {
      sectionId: input.sectionId,
      enteredAt: inserted.entered_at,
      expiresAt: inserted.expires_at,
      attemptStartedAt: updatedAttempt.started_at,
      attemptExpiresAt: updatedAttempt.expires_at,
    },
  }
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

    if (!isPastDeadline(active.expires_at, input.now)) {
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
