import type { PgQueryable } from "@liam-workspace/node-postgres"

export type ReminderLocale = "de" | "en" | "es" | "fr" | "it" | "ja"

export interface ReminderSubscriptionInput {
  studentId: string
  endpoint: string
  p256dh: string
  auth: string
  timezone: string
  locale: ReminderLocale
  hour: number
  minute: number
}

export interface ReminderSubscriptionRow extends ReminderSubscriptionInput {
  /** The student's LOCAL calendar date, `YYYY-MM-DD`, of the last reminder. */
  lastSentOn: string | null
}

interface ReminderDbRow {
  student_id: string
  endpoint: string
  p256dh: string
  auth: string
  timezone: string
  locale: ReminderLocale
  hour: number
  minute: number
  last_sent_on: string | null
}

export const REMINDER_COLUMNS = `student_id, endpoint, p256dh, auth, timezone, locale,
  hour, minute, to_char(last_sent_on, 'YYYY-MM-DD') AS last_sent_on`

export function toReminderRow(row: ReminderDbRow): ReminderSubscriptionRow {
  return {
    studentId: row.student_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    timezone: row.timezone,
    locale: row.locale,
    hour: row.hour,
    minute: row.minute,
    lastSentOn: row.last_sent_on,
  }
}

/**
 * Two statements, not one data-modifying CTE: PostgreSQL does not let a
 * sub-statement's DELETE free a unique key for a sibling INSERT in the same
 * command. Evicting the endpoint's previous holder first is what makes a
 * shared phone follow whoever subscribed last; the window between the two
 * statements can only fail the upsert with a unique violation (caller retries
 * by tapping again), never leave two students on one endpoint.
 *
 * POOL ONLY: the retry below assumes an autocommit connection. On a
 * transaction client the first unique violation aborts the transaction and the
 * retry fails with 25P02. A second violation is rethrown as is; the HTTP
 * service maps it to 409.
 *
 * `last_sent_on` survives a re-subscribe from the SAME endpoint (toggling the
 * switch must not earn a second reminder today) and resets for a new one.
 */
export async function upsertReminderSubscription(
  db: PgQueryable,
  input: ReminderSubscriptionInput,
): Promise<ReminderSubscriptionRow> {
  try {
    return await evictAndUpsert(db, input)
  } catch (error) {
    // Two students subscribing from one phone at the same instant: the loser
    // of the race sees the winner's row appear between its DELETE and its
    // INSERT. One retry evicts that row too, so the last writer wins.
    if (!isEndpointConflict(error)) {
      throw error
    }

    return evictAndUpsert(db, input)
  }
}

function isEndpointConflict(error: unknown): boolean {
  const { code, constraint } = (error ?? {}) as {
    code?: unknown
    constraint?: unknown
  }

  return code === "23505" && constraint === "reminder_subscription_endpoint_key"
}

async function evictAndUpsert(
  db: PgQueryable,
  input: ReminderSubscriptionInput,
): Promise<ReminderSubscriptionRow> {
  await db.query(
    `DELETE FROM reminder_subscription WHERE endpoint = $1 AND student_id <> $2`,
    [input.endpoint, input.studentId],
  )

  const { rows } = await db.query<ReminderDbRow>(
    `INSERT INTO reminder_subscription
       (student_id, endpoint, p256dh, auth, timezone, locale, hour, minute)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (student_id) DO UPDATE
        SET last_sent_on = CASE
              WHEN reminder_subscription.endpoint = EXCLUDED.endpoint
              THEN reminder_subscription.last_sent_on END,
            endpoint = EXCLUDED.endpoint,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            timezone = EXCLUDED.timezone,
            locale = EXCLUDED.locale,
            hour = EXCLUDED.hour,
            minute = EXCLUDED.minute,
            updated_at = now()
     RETURNING ${REMINDER_COLUMNS}`,
    [
      input.studentId,
      input.endpoint,
      input.p256dh,
      input.auth,
      input.timezone,
      input.locale,
      input.hour,
      input.minute,
    ],
  )

  return toReminderRow(rows[0])
}

export async function findReminderSubscription(
  db: PgQueryable,
  studentId: string,
): Promise<ReminderSubscriptionRow | null> {
  const { rows } = await db.query<ReminderDbRow>(
    `SELECT ${REMINDER_COLUMNS} FROM reminder_subscription WHERE student_id = $1`,
    [studentId],
  )

  return rows.length > 0 ? toReminderRow(rows[0]) : null
}

export async function deleteReminderSubscription(
  db: PgQueryable,
  studentId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM reminder_subscription WHERE student_id = $1`,
    [studentId],
  )

  return (rowCount ?? 0) > 0
}

export interface ReminderCandidateRow extends ReminderSubscriptionRow {
  /** Latest `submitted_at` of the student's finished attempts, or null. */
  lastFinishedAt: Date | null
}

/**
 * Every subscription, with when the student last FINISHED an attempt (a
 * submitted OR a timed-out one; `submitted_at` is pinned to the deadline for
 * the latter). This table holds one row per student of a family-sized
 * deployment, so a full scan per minute is the simple right answer; if it
 * ever grows, page it by `student_id`.
 */
export async function listReminderCandidates(
  db: PgQueryable,
): Promise<ReminderCandidateRow[]> {
  const { rows } = await db.query<
    ReminderDbRow & { last_finished_at: Date | null }
  >(
    `SELECT ${REMINDER_COLUMNS},
            (SELECT max(a.submitted_at)
               FROM attempt a
              WHERE a.student_id = reminder_subscription.student_id
                AND a.status <> 'in_progress') AS last_finished_at
       FROM reminder_subscription
      ORDER BY student_id`,
  )

  return rows.map((row) => ({
    ...toReminderRow(row),
    lastFinishedAt: row.last_finished_at,
  }))
}

/** One student's reminder for one LOCAL date, as the scheduler read it. */
export interface ReminderClaim {
  readonly studentId: string
  /** The endpoint the scheduler read and will send to. */
  readonly endpoint: string
  /** The student's local calendar date, `YYYY-MM-DD`. */
  readonly localDate: string
}

/**
 * The at-most-once-per-local-day guard. The scheduler CLAIMS the date before
 * it sends, so two ticks (or two replicas) can never both send for the same
 * student and day; a failed send hands the claim back with
 * `releaseReminderClaim`. Conditional on the endpoint the caller read: a row
 * re-subscribed to another endpoint in between is not claimed (the next tick
 * sees the new row).
 */
export async function claimReminderSend(
  db: PgQueryable,
  claim: ReminderClaim,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE reminder_subscription
        SET last_sent_on = $2::date
      WHERE student_id = $1
        AND endpoint = $3
        AND last_sent_on IS DISTINCT FROM $2::date`,
    [claim.studentId, claim.localDate, claim.endpoint],
  )

  return (rowCount ?? 0) > 0
}

/**
 * Hands back `claim` by restoring `previous`. Conditional on the row still
 * holding the claimed date, so it never rewinds a date some other writer (a
 * later claim, a re-subscribe from a new endpoint) has set since.
 */
export async function releaseReminderClaim(
  db: PgQueryable,
  claim: ReminderClaim,
  previous: string | null,
): Promise<void> {
  await db.query(
    `UPDATE reminder_subscription
        SET last_sent_on = $3::date
      WHERE student_id = $1 AND last_sent_on = $2::date`,
    [claim.studentId, claim.localDate, previous],
  )
}

/**
 * By endpoint, not student: a dead endpoint is dead whoever holds it now
 * (a shared phone may have moved it to another student since it was read).
 */
export async function deleteReminderSubscriptionByEndpoint(
  db: PgQueryable,
  endpoint: string,
): Promise<void> {
  await db.query(`DELETE FROM reminder_subscription WHERE endpoint = $1`, [
    endpoint,
  ])
}
