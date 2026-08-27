import type { PgQueryable } from "@liam-public/node-postgres"

export type MediaKind = "audio" | "image"

export interface MediaAssetRow {
  id: string
  kind: MediaKind
  filename: string
  mimeType: string
  byteSize: number
  checksum: string
}

interface MediaAssetDbRow {
  id: string
  kind: MediaKind
  filename: string
  mime_type: string
  byte_size: string
  checksum: string
}

function toMediaAsset(row: MediaAssetDbRow): MediaAssetRow {
  return {
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    mimeType: row.mime_type,
    // `byte_size` is `bigint`, so node-postgres returns it as a string.
    // Numbers this size never approach MAX_SAFE_INTEGER (`mediaMaxBytes`
    // caps uploads far below it), so a plain `Number(...)` is safe here.
    byteSize: Number(row.byte_size),
    checksum: row.checksum,
  }
}

const COLUMNS = `id, kind, filename, mime_type, byte_size, checksum`

/**
 * Metadata-only insert. The caller (admin.service.ts) is the one that
 * coordinates a transaction wrapping this call with the file write to
 * `config.mediaRoot` -- that write is filesystem I/O, which does not
 * belong in a repository. Calling with a transactional client (rather
 * than the pool directly) is what lets the caller INSERT, then stream the
 * file, then COMMIT, so a mid-write failure rolls the row back too.
 *
 * `filename` is `UNIQUE` in the schema (`media_asset_filename_key`); a
 * duplicate surfaces here as a `23505` the caller maps to `409`, before
 * any bytes reach disk.
 */
export async function recordMediaAsset(
  db: PgQueryable,
  input: {
    kind: MediaKind
    filename: string
    mimeType: string
    byteSize: number
    checksum: string
  },
): Promise<MediaAssetRow> {
  const { rows } = await db.query<MediaAssetDbRow>(
    `INSERT INTO media_asset (kind, filename, mime_type, byte_size, checksum)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [
      input.kind,
      input.filename,
      input.mimeType,
      input.byteSize,
      input.checksum,
    ],
  )
  const [row] = rows

  return toMediaAsset(row)
}
