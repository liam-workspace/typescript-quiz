import type { PgQueryable } from "@liam-workspace/node-postgres"

export interface FailedWriteRow {
  id: string
  attemptId: string | null
  route: string
  reason: string
  rawBody: string
  byteSize: number | null
  clientVersion: string | null
  clientInstanceId: string | null
  receivedAt: Date
  replayedAt: Date | null
}

interface FailedWriteDbRow {
  id: string
  attempt_id: string | null
  route: string
  reason: string
  raw_body: string
  byte_size: number | null
  client_version: string | null
  client_instance_id: string | null
  received_at: Date
  replayed_at: Date | null
}

function toFailedWrite(row: FailedWriteDbRow): FailedWriteRow {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    route: row.route,
    reason: row.reason,
    rawBody: row.raw_body,
    byteSize: row.byte_size,
    clientVersion: row.client_version,
    clientInstanceId: row.client_instance_id,
    receivedAt: row.received_at,
    replayedAt: row.replayed_at,
  }
}

/**
 * This table's whole job is accepting garbage: no foreign key on
 * attempt_id, nothing validated. `received_at` is written from the caller's
 * Clock, never the column's `now()` default, so capture time is
 * deterministic under test.
 */
/**
 * Postgres `text` cannot hold a literal NUL: the insert dies with
 * `invalid byte sequence for encoding "UTF8": 0x00` (verified against a real
 * database, not assumed).
 *
 * That matters more here than anywhere else in the schema. This table exists
 * to keep what the server refused, and the payloads most likely to be refused
 * are the malformed ones -- a truncated upload, a binary body sent to a JSON
 * route, a corrupted request. Those are exactly the bodies that carry NULs.
 * Left unhandled, the capture itself throws, so the answer is lost AND the
 * mechanism meant to preserve it fails in the same breath -- the precise
 * failure spec §5.4 exists to prevent.
 *
 * Escaped rather than stripped: `\x00` keeps the byte count and the position
 * honest, so a later reader can see the body was binary rather than wondering
 * why it looks subtly short. `byte_size` still records the ORIGINAL length.
 */
function sanitiseForTextColumn(raw: string): string {
  return raw.replaceAll("\u0000", "\\x00")
}

export async function insertFailedWrite(
  db: PgQueryable,
  input: {
    attemptId: string | null
    route: string
    reason: string
    rawBody: string
    byteSize: number | null
    clientVersion: string | null
    clientInstanceId: string | null
    now: Date
  },
): Promise<FailedWriteRow> {
  const { rows } = await db.query<FailedWriteDbRow>(
    `INSERT INTO failed_write
       (attempt_id, route, reason, raw_body, byte_size, client_version,
        client_instance_id, received_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, attempt_id, route, reason, raw_body, byte_size,
               client_version, client_instance_id, received_at, replayed_at`,
    [
      input.attemptId,
      input.route,
      input.reason,
      sanitiseForTextColumn(input.rawBody),
      input.byteSize,
      input.clientVersion,
      input.clientInstanceId,
      input.now,
    ],
  )

  const [row] = rows

  return toFailedWrite(row)
}
