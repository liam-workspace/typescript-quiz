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
