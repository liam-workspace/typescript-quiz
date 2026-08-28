import {
  asChoiceId,
  asQuestionId,
  asSectionId,
  asStimulusId,
  gradeAttempt,
  isQuestionCorrect,
  type ChoiceId,
  type GradableResponse,
  type GradableSection,
  type GradeResult,
  type SectionScore,
} from "@pp/common"
import type { ScoringQuestion } from "@pp/common/scoring"
import type { PgPool, PgQueryable } from "@liam-public/node-postgres"
import { InvalidCursorError } from "./catalog.repository.js"
import { loadForScoring } from "./test-version.repository.js"

export interface AttemptHistoryRow {
  id: string
  testTitle: string
  submittedAt: Date
  status: "submitted" | "expired"
  pointsEarned: number
  pointsPossible: number
  percentage: number
  sections: SectionScore[]
}

export interface ListAttemptHistoryResult {
  attempts: AttemptHistoryRow[]
  nextCursor: string | null
}

interface AttemptHistoryCursor {
  submittedAt: string
  id: string
}

interface AttemptHistoryDbRow {
  id: string
  test_version_id: string
  test_title: string
  submitted_at: Date
  cursor_submitted_at: string
  status: "submitted" | "expired"
  points_earned: number
  points_possible: number
  percentage: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function encodeAttemptHistoryCursor(cursor: AttemptHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

function isAttemptHistoryCursor(value: unknown): value is AttemptHistoryCursor {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.submittedAt === "string" &&
    !Number.isNaN(Date.parse(candidate.submittedAt)) &&
    typeof candidate.id === "string" &&
    UUID_PATTERN.test(candidate.id)
  )
}

function decodeAttemptHistoryCursor(raw: string): AttemptHistoryCursor {
  let parsed: unknown = undefined

  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
  } catch {
    throw new InvalidCursorError("bad_cursor")
  }

  if (!isAttemptHistoryCursor(parsed)) {
    throw new InvalidCursorError("bad_cursor")
  }

  return parsed
}

/**
 * This student's terminal attempts in the exact order supported by
 * attempt_history_idx: submitted_at DESC, then id ASC. The UUID is the
 * total-order tiebreaker because submitted_at can legitimately tie.
 */
export async function listAttemptHistory(
  pool: PgPool,
  input: {
    studentId: string
    status: "finished" | "submitted" | "expired"
    limit: number
    cursor: string | null
  },
): Promise<ListAttemptHistoryResult> {
  const cursor =
    input.cursor === null ? null : decodeAttemptHistoryCursor(input.cursor)
  const { rows } = await pool.query<AttemptHistoryDbRow>(
    `SELECT a.id, a.test_version_id, tv.title AS test_title,
            a.submitted_at, a.submitted_at::text AS cursor_submitted_at,
            a.status,
            a.points_earned, a.points_possible, a.percentage
       FROM attempt a
       JOIN test_version tv ON tv.id = a.test_version_id
      WHERE a.student_id = $1
        AND a.status <> 'in_progress'
        AND ($2 = 'finished' OR a.status::text = $2)
        AND (
          $3::timestamptz IS NULL
          OR a.submitted_at < $3
          OR (a.submitted_at = $3 AND a.id > $4::uuid)
        )
      ORDER BY a.submitted_at DESC, a.id ASC
      LIMIT $5`,
    [
      input.studentId,
      input.status,
      cursor?.submittedAt ?? null,
      cursor?.id ?? null,
      input.limit + 1,
    ],
  )

  const hasMore = rows.length > input.limit
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows

  const attempts = await Promise.all(
    pageRows.map(async (row): Promise<AttemptHistoryRow> => {
      // Deliberate N+1, capped at 50: gradeExistingAttempt is the one pure
      // implementation of the section breakdown. Re-deriving correctness in
      // a SQL aggregate would create a second grading implementation that can
      // silently drift from gradeAttempt.
      const fresh = await gradeExistingAttempt(pool, {
        attemptId: row.id,
        testVersionId: row.test_version_id,
      })

      return {
        id: row.id,
        testTitle: row.test_title,
        submittedAt: row.submitted_at,
        status: row.status,
        pointsEarned: row.points_earned,
        pointsPossible: row.points_possible,
        // Node-postgres returns numeric as a string. Normalize it at the
        // repository boundary so every consumer sees the contract's number.
        percentage: Number(row.percentage),
        sections: fresh.sections,
      }
    }),
  )

  const lastRow = pageRows[pageRows.length - 1]

  return {
    attempts,
    nextCursor: hasMore
      ? encodeAttemptHistoryCursor({
          // Keep PostgreSQL's full microsecond precision. A JS Date would
          // truncate this key to milliseconds and skip a tied row when the
          // tie straddles two pages.
          submittedAt: lastRow.cursor_submitted_at,
          id: lastRow.id,
        })
      : null,
  }
}

export type AttemptResultOutcome =
  | { kind: "not_found" }
  | { kind: "still_running" }
  // In progress, but the clock has run out. A read must finalize it rather
  // than refuse -- 409 is StillRunning, and an attempt past its deadline is
  // not running. `expiresAt` is carried out so the caller pins submitted_at
  // to the DEADLINE, never to the moment of the late read.
  | { kind: "expired_unfinalized"; expiresAt: Date }
  | {
      kind: "ready"
      result: {
        attemptId: string
        testTitle: string
        testVersion: number
        status: "submitted" | "expired"
        submittedAt: Date
        elapsedSeconds: number
        score: GradeResult
        isPersonalBest: boolean
      }
    }

interface AttemptResultDbRow {
  attempt_id: string
  test_version_id: string
  test_title: string
  test_version: number
  status: "in_progress" | "submitted" | "expired"
  submitted_at: Date | null
  expires_at: Date | null
  elapsed_seconds: number
  points_earned: number | null
  points_possible: number | null
  percentage: string | null
  answered_count: number | null
  unanswered_count: number | null
  correct_count: number | null
  incorrect_count: number | null
  is_personal_best: boolean
}

interface SectionDbRow {
  id: string
  title: string
  type: string
}

interface ResponseDbRow {
  question_id: string
  choice_ids: string[]
}

export interface ReviewChoice {
  id: string
  label: string
  isCorrect: boolean
  selected: boolean
  imageSvg?: string
}

export type ReviewStimulus =
  | {
      id: string
      type: "audio" | "image"
      title?: string
      mediaUrl: string
      replayable: true
    }
  | {
      id: string
      type: "passage"
      title: string
      bodyText: string
      replayable: true
    }
  | {
      id: string
      type: "mixed"
      title?: string
      bodyText: string
      mediaUrl: string
      // "mixed" says text-plus-media, never WHICH media. Without this the
      // client has to guess an audio player or a picture from the filename.
      mediaKind: "audio" | "image"
      replayable: true
    }

export interface ReviewItem {
  questionId: string
  ordinal: number
  sectionId: string
  // Carried, not inferred. The review screen used to guess "listening vs
  // reading" from a section's POSITION in the item list, which is only ever
  // right for a two-section test in the expected order -- and the section
  // type enum has four values.
  sectionType: "listening" | "reading" | "vocabulary" | "grammar"
  prompt: string
  outcome: "correct" | "incorrect" | "unanswered"
  stimulus?: ReviewStimulus
  choices: ReviewChoice[]
}

export type ReviewOutcome =
  | { kind: "not_found" }
  | { kind: "still_running" }
  | { kind: "expired_unfinalized"; expiresAt: Date }
  | { kind: "ready"; items: ReviewItem[] }

interface ReviewAttemptDbRow {
  test_version_id: string
  status: "in_progress" | "submitted" | "expired"
  expires_at: Date | null
}

interface ReviewDbRow {
  q_id: string
  q_ordinal: number
  q_prompt: string
  q_type: string
  q_points: number
  section_id: string
  section_type: string
  c_id: string
  c_label: string
  c_is_correct: boolean
  c_selected: boolean
  c_image_svg: string | null
  st_id: string | null
  st_type: string | null
  st_title: string | null
  st_body: string | null
  st_filename: string | null
  st_media_kind: string | null
}

interface ReviewAccumulator {
  item: Omit<ReviewItem, "outcome">
  scoringQuestion: ScoringQuestion
  selectedChoiceIds: ChoiceId[]
}

/**
 * Recomputes the uncached section breakdown from frozen content and frozen
 * responses. This helper never writes: only finalizeAttemptTx owns score
 * persistence. It stays internal to @pp/db so the answer-key projection it
 * consumes cannot cross into a student-facing server module.
 */
export async function gradeExistingAttempt(
  db: PgQueryable,
  input: { attemptId: string; testVersionId: string },
): Promise<GradeResult> {
  const [{ rows: sectionRows }, questions, { rows: responseRows }] =
    await Promise.all([
      db.query<SectionDbRow>(
        `SELECT id, title, type::text AS type
           FROM test_section
          WHERE test_version_id = $1
          ORDER BY ordinal`,
        [input.testVersionId],
      ),
      loadForScoring(db, input.testVersionId),
      db.query<ResponseDbRow>(
        `SELECT r.question_id,
                COALESCE(
                  array_agg(rc.choice_id) FILTER (WHERE rc.choice_id IS NOT NULL),
                  '{}'
                ) AS choice_ids
           FROM response r
           LEFT JOIN response_choice rc
             ON rc.attempt_id = r.attempt_id
            AND rc.question_id = r.question_id
          WHERE r.attempt_id = $1
          GROUP BY r.question_id`,
        [input.attemptId],
      ),
    ])

  const sections: GradableSection[] = sectionRows.map((row) => ({
    id: asSectionId(row.id),
    title: row.title,
    type: row.type as GradableSection["type"],
  }))
  const responses: GradableResponse[] = responseRows.map((row) => ({
    questionId: asQuestionId(row.question_id),
    selectedChoiceIds: row.choice_ids.map(asChoiceId),
  }))

  return gradeAttempt({ sections, questions, responses })
}

/**
 * Loads only an already-finished result. An in-progress row has no result,
 * even when its deadline is in the past; expiry/finalization remains owned by
 * the established attempt write paths and is never triggered by this read.
 */
export async function loadAttemptResult(
  pool: PgPool,
  input: { attemptId: string; now: Date },
): Promise<AttemptResultOutcome> {
  const { rows } = await pool.query<AttemptResultDbRow>(
    `SELECT a.id AS attempt_id,
            a.test_version_id,
            tv.title AS test_title,
            tv.version AS test_version,
            a.status,
            a.submitted_at,
            a.expires_at,
            CASE
              WHEN a.started_at IS NULL OR a.submitted_at IS NULL THEN 0
              ELSE GREATEST(
                0,
                FLOOR(EXTRACT(EPOCH FROM (a.submitted_at - a.started_at)))
              )::integer
            END AS elapsed_seconds,
            a.points_earned,
            a.points_possible,
            a.percentage,
            a.answered_count,
            a.unanswered_count,
            a.correct_count,
            a.incorrect_count,
            NOT EXISTS (
              SELECT 1
                FROM attempt better
               WHERE better.student_id = a.student_id
                 AND better.test_version_id = a.test_version_id
                 AND better.status <> 'in_progress'
                 AND better.percentage > a.percentage
            ) AS is_personal_best
       FROM attempt a
       JOIN test_version tv ON tv.id = a.test_version_id
      WHERE a.id = $1`,
    [input.attemptId],
  )

  if (rows.length === 0) {
    return { kind: "not_found" }
  }

  const [row] = rows

  if (row.status === "in_progress") {
    if (row.expires_at !== null && row.expires_at <= input.now) {
      return { kind: "expired_unfinalized", expiresAt: row.expires_at }
    }

    // `expires_at IS NULL` means untimed, not expired: an attempt created but
    // never entered has no deadline yet.
    return { kind: "still_running" }
  }

  if (
    row.submitted_at === null ||
    row.points_earned === null ||
    row.points_possible === null ||
    row.percentage === null ||
    row.answered_count === null ||
    row.unanswered_count === null ||
    row.correct_count === null ||
    row.incorrect_count === null
  ) {
    throw new Error(
      `attempt ${input.attemptId} is terminal but missing a graded column`,
    )
  }

  const fresh = await gradeExistingAttempt(pool, {
    attemptId: row.attempt_id,
    testVersionId: row.test_version_id,
  })

  return {
    kind: "ready",
    result: {
      attemptId: row.attempt_id,
      testTitle: row.test_title,
      testVersion: row.test_version,
      status: row.status,
      submittedAt: row.submitted_at,
      elapsedSeconds: row.elapsed_seconds,
      score: {
        pointsEarned: row.points_earned,
        pointsPossible: row.points_possible,
        percentage: Number(row.percentage),
        answered: row.answered_count,
        unanswered: row.unanswered_count,
        correct: row.correct_count,
        incorrect: row.incorrect_count,
        sections: fresh.sections,
      },
      isPersonalBest: row.is_personal_best,
    },
  }
}

/**
 * The deliberate student-facing answer-key projection. This repository is
 * exported only through `@pp/db/scoring`; the review route may consume it
 * after the attempt is terminal, while the default `@pp/db` surface remains
 * incapable of supplying `choice.isCorrect` to runner/result handlers.
 *
 * This function is read-only. As with loadAttemptResult, an expired clock is
 * reported distinctly so the server can delegate the only grading write to
 * the idempotent finalizeAttempt path and then read again.
 */
export async function loadReview(
  pool: PgPool,
  input: {
    attemptId: string
    now: Date
    // A builder rather than a base URL: /media refuses any CAPPED filename
    // without a valid signature, and review's whole promise is that "media is
    // freely replayable, the attempt is over". Signing needs the secret and
    // the clock, which are server concerns -- so the caller supplies the
    // mapping and this repository stays ignorant of both.
    mediaUrlFor: (filename: string) => string
  },
): Promise<ReviewOutcome> {
  const { rows: attemptRows } = await pool.query<ReviewAttemptDbRow>(
    `SELECT test_version_id, status, expires_at
       FROM attempt
      WHERE id = $1`,
    [input.attemptId],
  )

  if (attemptRows.length === 0) {
    return { kind: "not_found" }
  }

  const [attempt] = attemptRows

  if (attempt.status === "in_progress") {
    if (attempt.expires_at !== null && attempt.expires_at <= input.now) {
      return {
        kind: "expired_unfinalized",
        expiresAt: attempt.expires_at,
      }
    }

    return { kind: "still_running" }
  }

  const { rows } = await pool.query<ReviewDbRow>(
    `SELECT q.id q_id, q.ordinal q_ordinal, q.prompt q_prompt,
            q.type::text q_type, q.points q_points,
            ts.id section_id, ts.type::text section_type,
            c.id c_id, c.label c_label, c.is_correct c_is_correct,
            (rc.choice_id IS NOT NULL) c_selected, c.image_svg c_image_svg,
            st.id st_id, st.type::text st_type, st.title st_title,
            st.body_text st_body, ma.filename st_filename,
            ma.kind::text st_media_kind
       FROM question q
       JOIN question_group g ON g.id = q.question_group_id
       JOIN test_section ts  ON ts.id = g.test_section_id
  LEFT JOIN stimulus st      ON st.id = g.stimulus_id
  LEFT JOIN media_asset ma   ON ma.id = st.media_asset_id
       JOIN choice c         ON c.question_id = q.id
  LEFT JOIN response_choice rc
         ON rc.attempt_id = $2
        AND rc.question_id = q.id
        AND rc.choice_id = c.id
      WHERE q.test_version_id = $1
      ORDER BY q.ordinal, c.ordinal`,
    [attempt.test_version_id, input.attemptId],
  )

  const accumulators: ReviewAccumulator[] = []

  for (const row of rows) {
    const accumulator = findOrCreateReview(accumulators, row, input.mediaUrlFor)
    const choiceId = asChoiceId(row.c_id)

    accumulator.item.choices.push({
      id: choiceId,
      label: row.c_label,
      isCorrect: row.c_is_correct,
      selected: row.c_selected,
      ...(row.c_image_svg ? { imageSvg: row.c_image_svg } : {}),
    })
    accumulator.scoringQuestion.choices.push({
      id: choiceId,
      label: row.c_label,
      isCorrect: row.c_is_correct,
    })

    if (row.c_selected) {
      accumulator.selectedChoiceIds.push(choiceId)
    }
  }

  return {
    kind: "ready",
    items: accumulators.map(toReviewItem),
  }
}

function findOrCreateReview(
  accumulators: ReviewAccumulator[],
  row: ReviewDbRow,
  mediaUrlFor: (filename: string) => string,
): ReviewAccumulator {
  const questionId = asQuestionId(row.q_id)
  const existing = accumulators.find(
    (accumulator) => accumulator.item.questionId === questionId,
  )

  if (existing) {
    return existing
  }

  const sectionId = asSectionId(row.section_id)
  const accumulator: ReviewAccumulator = {
    item: {
      questionId,
      // Unlike numeric/bigint, PostgreSQL integer is parsed as a number.
      // Keeping that driver-boundary type explicit prevents a string ordinal
      // from silently reaching the wire if this query changes later.
      ordinal: row.q_ordinal,
      sectionId,
      sectionType: row.section_type as ReviewItem["sectionType"],
      prompt: row.q_prompt,
      ...(row.st_id
        ? { stimulus: buildReviewStimulus(row, row.st_id, mediaUrlFor) }
        : {}),
      choices: [],
    },
    scoringQuestion: {
      id: questionId,
      sectionId,
      ordinal: row.q_ordinal,
      type: row.q_type as ScoringQuestion["type"],
      prompt: row.q_prompt,
      points: row.q_points,
      choices: [],
    },
    selectedChoiceIds: [],
  }

  accumulators.push(accumulator)

  return accumulator
}

function buildReviewStimulus(
  row: ReviewDbRow,
  stimulusId: string,
  mediaUrlFor: (filename: string) => string,
): ReviewStimulus {
  const id = asStimulusId(stimulusId)
  const mediaUrl = row.st_filename ? mediaUrlFor(row.st_filename) : null

  if (row.st_type === "audio" || row.st_type === "image") {
    if (!mediaUrl) {
      throw new Error(`review stimulus ${stimulusId} is missing media`)
    }

    return {
      id,
      type: row.st_type,
      ...(row.st_title ? { title: row.st_title } : {}),
      mediaUrl,
      replayable: true,
    }
  }

  if (row.st_type === "passage") {
    if (row.st_title === null || row.st_body === null) {
      throw new Error(`review passage ${stimulusId} is missing text`)
    }

    return {
      id,
      type: "passage",
      title: row.st_title,
      bodyText: row.st_body,
      replayable: true,
    }
  }

  if (row.st_type === "mixed") {
    // `mixed` names only "text plus media", so unlike the audio/image branch
    // above its own type says nothing about WHICH. media_asset.kind has always
    // known; projecting it here is what lets review render an audio player or
    // a picture instead of guessing from the filename.
    if (
      row.st_body === null ||
      !mediaUrl ||
      (row.st_media_kind !== "audio" && row.st_media_kind !== "image")
    ) {
      throw new Error(`review mixed stimulus ${stimulusId} is incomplete`)
    }

    return {
      id,
      type: "mixed",
      ...(row.st_title ? { title: row.st_title } : {}),
      bodyText: row.st_body,
      mediaUrl,
      mediaKind: row.st_media_kind,
      replayable: true,
    }
  }

  throw new Error(`review stimulus ${stimulusId} has unknown type`)
}

function toReviewItem(accumulator: ReviewAccumulator): ReviewItem {
  let outcome: ReviewItem["outcome"] = "unanswered"

  if (accumulator.selectedChoiceIds.length > 0) {
    outcome = isQuestionCorrect(
      accumulator.scoringQuestion,
      accumulator.selectedChoiceIds,
    )
      ? "correct"
      : "incorrect"
  }

  return {
    ...accumulator.item,
    outcome,
  }
}
