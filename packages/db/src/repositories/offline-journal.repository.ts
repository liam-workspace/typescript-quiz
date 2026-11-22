import {
  withTransaction,
  type PgPool,
  type PgQueryable,
} from "@liam-workspace/node-postgres"
import { isPastDeadline } from "@pp/common"
import { finalizeExpiredAttempt } from "./attempt.repository.js"

/** The highest journal eventSeq already applied; 0 when nothing has been. */
export async function getJournalCursor(
  db: PgQueryable,
  attemptId: string,
): Promise<number> {
  const { rows } = await db.query<{ last_event_seq: number }>(
    "SELECT last_event_seq FROM offline_journal_cursor WHERE attempt_id = $1",
    [attemptId],
  )

  return rows.find((_row, index) => index === 0)?.last_event_seq ?? 0
}

/** GREATEST keeps the cursor monotonic even if two syncs ever interleave. */
export async function advanceJournalCursor(
  db: PgQueryable,
  attemptId: string,
  eventSeq: number,
): Promise<void> {
  await db.query(
    `INSERT INTO offline_journal_cursor (attempt_id, last_event_seq)
     VALUES ($1, $2)
     ON CONFLICT (attempt_id) DO UPDATE
        SET last_event_seq = GREATEST(offline_journal_cursor.last_event_seq, EXCLUDED.last_event_seq),
            updated_at = now()`,
    [attemptId, eventSeq],
  )
}

export type CreateOfflineAttemptOutcome =
  | { kind: "created" }
  | { kind: "exists" }
  | { kind: "conflict" }
  | { kind: "version_unavailable" }

/**
 * The offline counterpart of `startOrResumeAttempt`. It deliberately does NOT
 * resume: an offline `start` event describes a NEW attempt, and silently
 * applying its journal to a different, already-running attempt would corrupt
 * both. A live (not past its deadline) attempt for the same student and
 * version is therefore a `conflict`; a stale one is finalized first, exactly
 * as `startOrResumeAttempt` does.
 *
 * `exists` means "this very attempt, already adopted by an earlier sync":
 * same id AND same student AND same version. The same id under anyone else
 * is a `conflict` -- reporting it as `exists` would invite the caller to
 * replay one student's journal onto another student's attempt.
 *
 * The row is created at the CLAIMED time (`now`), never the request time.
 * `ON CONFLICT DO NOTHING` without a target absorbs both the primary key and
 * the `attempt_one_active` partial unique index, so a lost race is a plain
 * zero-row result rather than a statement error that would poison the
 * enclosing transaction.
 *
 * Takes a pool, not a transaction client: it opens its own transaction.
 */
export function createOfflineAttempt(
  db: PgPool,
  input: {
    attemptId: string
    studentId: string
    testVersionId: string
    slug: string
    now: Date
  },
): Promise<CreateOfflineAttemptOutcome> {
  return withTransaction(db, async (tx) => {
    const { rows: versions } = await tx.query(
      `SELECT 1
         FROM test_version tv
         JOIN test t ON t.id = tv.test_id
        WHERE tv.id = $1 AND t.slug = $2 AND tv.published_at IS NOT NULL`,
      [input.testVersionId, input.slug],
    )

    if (versions.length === 0) {
      return { kind: "version_unavailable" }
    }

    const { rows: existing } = await tx.query<{
      student_id: string
      test_version_id: string
    }>("SELECT student_id, test_version_id FROM attempt WHERE id = $1", [
      input.attemptId,
    ])
    const sameId = existing.find((_row, index) => index === 0)

    if (sameId) {
      const isThisAttempt =
        sameId.student_id === input.studentId &&
        sameId.test_version_id === input.testVersionId

      return isThisAttempt ? { kind: "exists" } : { kind: "conflict" }
    }

    const { rows: active } = await tx.query<{
      id: string
      expires_at: Date | null
    }>(
      `SELECT id, expires_at FROM attempt
        WHERE student_id = $1 AND test_version_id = $2 AND status = 'in_progress'
        FOR UPDATE`,
      [input.studentId, input.testVersionId],
    )
    const live = active.find((_row, index) => index === 0)

    if (live) {
      // `expires_at IS NULL` (created, never entered) is "not past" too: an
      // untimed online attempt is still that student's attempt to continue.
      if (!isPastDeadline(live.expires_at, input.now)) {
        return { kind: "conflict" }
      }

      await finalizeExpiredAttempt(tx, { attemptId: live.id, now: input.now })
    }

    const { rows: created } = await tx.query(
      `INSERT INTO attempt (id, student_id, test_version_id, status, origin, created_at)
       VALUES ($1, $2, $3, 'in_progress', 'offline', $4)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [input.attemptId, input.studentId, input.testVersionId, input.now],
    )

    return created.length === 0 ? { kind: "conflict" } : { kind: "created" }
  })
}

export interface JournalContextRows {
  versionDurationSeconds: number
  sections: Array<{
    id: string
    ordinal: number
    durationSeconds: number
    navigation: "free" | "forward_only"
    allowAnswerChange: boolean
  }>
  /** Media-backed stimuli only; `maxPlays` is the effective (stimulus ?? section) cap. */
  stimuli: Array<{ id: string; sectionId: string; maxPlays: number | null }>
  questions: Array<{ id: string; sectionId: string; ordinal: number }>
  playsUsed: Array<{ stimulusId: string; playCount: number }>
  sectionStates: Array<{
    sectionId: string
    enteredAt: Date
    expiresAt: Date
    completedAt: Date | null
  }>
  /** Null when no attempt was asked for (a journal that starts a new one). */
  attemptStatus: "in_progress" | "submitted" | "expired" | null
  attemptStartedAt: Date | null
  attemptExpiresAt: Date | null
  currentSectionId: string | null
  currentQuestionId: string | null
}

interface AttemptContextDbRow {
  status: "in_progress" | "submitted" | "expired"
  started_at: Date | null
  expires_at: Date | null
  current_section_id: string | null
  current_question_id: string | null
}

/**
 * Everything the pure journal validator needs, read once. Only MEDIA-backed
 * stimuli are listed: a passage cannot be "played", so a `play` event naming
 * one is a malformed journal, not a cap question.
 *
 * The attempt is read scoped by id AND student AND version. An attempt that
 * is not this student's (or not on this version) throws: the caller is
 * expected to have resolved ownership already, so reaching here with a
 * foreign id is a bug that must not quietly yield an "empty" attempt.
 */
export async function loadJournalContext(
  db: PgQueryable,
  input: {
    attempt: { attemptId: string; studentId: string } | null
    testVersionId: string
  },
): Promise<JournalContextRows> {
  const [version, sections, stimuli, questions] = await Promise.all([
    db.query<{ duration_seconds: number }>(
      "SELECT duration_seconds FROM test_version WHERE id = $1",
      [input.testVersionId],
    ),
    db.query<{
      id: string
      ordinal: number
      duration_seconds: number
      navigation: "free" | "forward_only"
      allow_answer_change: boolean
    }>(
      `SELECT id, ordinal, duration_seconds, navigation::text AS navigation, allow_answer_change
         FROM test_section WHERE test_version_id = $1 ORDER BY ordinal`,
      [input.testVersionId],
    ),
    db.query<{ id: string; section_id: string; max_plays: number | null }>(
      `SELECT DISTINCT ON (st.id)
              st.id, ts.id AS section_id,
              COALESCE(st.max_plays, ts.default_max_plays) AS max_plays
         FROM stimulus st
         JOIN question_group qg ON qg.stimulus_id = st.id
         JOIN test_section ts ON ts.id = qg.test_section_id
        WHERE st.test_version_id = $1 AND st.media_asset_id IS NOT NULL
        ORDER BY st.id, ts.ordinal`,
      [input.testVersionId],
    ),
    db.query<{ id: string; section_id: string; ordinal: number }>(
      `SELECT q.id, ts.id AS section_id, q.ordinal
         FROM question q
         JOIN question_group qg ON qg.id = q.question_group_id
         JOIN test_section ts ON ts.id = qg.test_section_id
        WHERE q.test_version_id = $1
        ORDER BY q.ordinal`,
      [input.testVersionId],
    ),
  ])

  const versionRow = version.rows.find((_row, index) => index === 0)

  if (!versionRow) {
    throw new Error(`test version ${input.testVersionId} does not exist`)
  }

  const base = {
    versionDurationSeconds: versionRow.duration_seconds,
    sections: sections.rows.map((row) => ({
      id: row.id,
      ordinal: row.ordinal,
      durationSeconds: row.duration_seconds,
      navigation: row.navigation,
      allowAnswerChange: row.allow_answer_change,
    })),
    stimuli: stimuli.rows.map((row) => ({
      id: row.id,
      sectionId: row.section_id,
      maxPlays: row.max_plays,
    })),
    questions: questions.rows.map((row) => ({
      id: row.id,
      sectionId: row.section_id,
      ordinal: row.ordinal,
    })),
  }

  if (input.attempt === null) {
    return {
      ...base,
      playsUsed: [],
      sectionStates: [],
      attemptStatus: null,
      attemptStartedAt: null,
      attemptExpiresAt: null,
      currentSectionId: null,
      currentQuestionId: null,
    }
  }

  const { attemptId, studentId } = input.attempt
  const { rows: attemptRows } = await db.query<AttemptContextDbRow>(
    `SELECT status, started_at, expires_at, current_section_id, current_question_id
       FROM attempt
      WHERE id = $1 AND student_id = $2 AND test_version_id = $3`,
    [attemptId, studentId, input.testVersionId],
  )
  const attempt = attemptRows.find((_row, index) => index === 0)

  if (!attempt) {
    throw new Error(
      `${attemptId} is not an attempt of student ${studentId} on version ${input.testVersionId}`,
    )
  }

  const [plays, states] = await Promise.all([
    db.query<{ stimulus_id: string; play_count: number }>(
      "SELECT stimulus_id, play_count FROM stimulus_play WHERE attempt_id = $1",
      [attemptId],
    ),
    db.query<{
      test_section_id: string
      entered_at: Date
      expires_at: Date
      completed_at: Date | null
    }>(
      `SELECT test_section_id, entered_at, expires_at, completed_at
         FROM attempt_section WHERE attempt_id = $1 ORDER BY entered_at`,
      [attemptId],
    ),
  ])

  return {
    ...base,
    playsUsed: plays.rows.map((row) => ({
      stimulusId: row.stimulus_id,
      playCount: row.play_count,
    })),
    sectionStates: states.rows.map((row) => ({
      sectionId: row.test_section_id,
      enteredAt: row.entered_at,
      expiresAt: row.expires_at,
      completedAt: row.completed_at,
    })),
    attemptStatus: attempt.status,
    attemptStartedAt: attempt.started_at,
    attemptExpiresAt: attempt.expires_at,
    currentSectionId: attempt.current_section_id,
    currentQuestionId: attempt.current_question_id,
  }
}
