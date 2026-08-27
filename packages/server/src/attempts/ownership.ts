import type { PgQueryable } from "@liam-public/node-postgres"
import { findStudentBySubject } from "@pp/db"

export type OwnedAttempt =
  | { kind: "ok"; studentId: string }
  | { kind: "not_found" }
  | { kind: "forbidden" }

/** Shared ownership lookup for submit and the result/history routes that follow. */
export async function resolveOwnedAttempt(
  db: PgQueryable,
  input: { attemptId: string; subjectClaim: string },
): Promise<OwnedAttempt> {
  const student = await findStudentBySubject(db, input.subjectClaim)

  if (!student) {
    return { kind: "forbidden" }
  }

  const { rows } = await db.query<{ student_id: string }>(
    "SELECT student_id FROM attempt WHERE id = $1",
    [input.attemptId],
  )

  if (rows.length === 0) {
    return { kind: "not_found" }
  }

  if (rows[0]?.student_id !== student.id) {
    return { kind: "forbidden" }
  }

  return { kind: "ok", studentId: student.id }
}
