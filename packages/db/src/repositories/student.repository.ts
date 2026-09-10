import type { PgQueryable } from "@liam-workspace/node-postgres"

export interface StudentRow {
  id: string
  subjectClaim: string
  email: string
  displayName: string
  pictureUrl: string | null
  level: "primary-step-1" | "primary-step-2" | null
}

interface StudentDbRow {
  id: string
  subject_claim: string
  email: string
  display_name: string
  picture_url: string | null
  level: "primary-step-1" | "primary-step-2" | null
}

function toStudent(row: StudentDbRow): StudentRow {
  return {
    id: row.id,
    subjectClaim: row.subject_claim,
    email: row.email,
    displayName: row.display_name,
    pictureUrl: row.picture_url,
    level: row.level,
  }
}

const COLUMNS = `id, subject_claim, email, display_name, picture_url, level`

/**
 * `subject_claim` is the stable identity and is UNIQUE, but a person can
 * change their display name or primary email at the identity provider. The
 * DO UPDATE branch keeps the profile current instead of pinning it to
 * whatever it was at first sign-in.
 *
 * `(xmax = 0)` is how PostgreSQL distinguishes an INSERT from an UPDATE
 * inside ON CONFLICT DO UPDATE: on a fresh insert the row has no updating
 * transaction, so xmax is 0. It answers "did this call provision the row?"
 * in the same round trip. The obvious alternative -- SELECT, then INSERT if
 * missing -- is a race: two concurrent first sign-ins would both see no row.
 */
const UPSERT = `
  INSERT INTO student (subject_claim, email, display_name, picture_url)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (subject_claim) DO UPDATE
     SET email        = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         picture_url  = EXCLUDED.picture_url,
         updated_at   = now()
  RETURNING ${COLUMNS}, (xmax = 0) AS created
`

export async function upsertStudentBySubject(
  db: PgQueryable,
  input: {
    subjectClaim: string
    email: string
    displayName: string
    pictureUrl?: string | null
  },
): Promise<{ student: StudentRow; created: boolean }> {
  const { rows } = await db.query<StudentDbRow & { created: boolean }>(UPSERT, [
    input.subjectClaim,
    input.email,
    input.displayName,
    input.pictureUrl ?? null,
  ])
  const [row] = rows

  return { student: toStudent(row), created: row.created }
}

export async function findStudentBySubject(
  db: PgQueryable,
  subjectClaim: string,
): Promise<StudentRow | null> {
  const { rows } = await db.query<StudentDbRow>(
    `SELECT ${COLUMNS} FROM student WHERE subject_claim = $1`,
    [subjectClaim],
  )

  // `rows[0]` types as non-undefined because noUncheckedIndexedAccess is
  // off, so a truthiness check reads as redundant to the linter while still
  // being the thing that matters at runtime. Test the length instead.
  if (rows.length === 0) {
    return null
  }

  const [row] = rows

  return toStudent(row)
}
