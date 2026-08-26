import { describe, expect, it } from "vitest"
import {
  findStudentBySubject,
  upsertStudentBySubject,
} from "../src/repositories/student.repository.js"
import { withDatabase } from "./helpers/database.js"

const IDENTITY = {
  subjectClaim: "google-oauth2|1234567890",
  email: "tom@example.com",
  displayName: "Tom",
}

describe("student repository", () => {
  it("creates a student on first sight and reports created: true", async () => {
    await withDatabase(async (pool) => {
      const { student, created } = await upsertStudentBySubject(pool, IDENTITY)

      expect(created).toBe(true)
      expect(student.subjectClaim).toBe(IDENTITY.subjectClaim)
      expect(student.email).toBe(IDENTITY.email)
      expect(student.displayName).toBe(IDENTITY.displayName)
      expect(student.pictureUrl).toBeNull()
      // `level` is null until a parent sets it; provisioning must not guess.
      expect(student.level).toBeNull()
      expect(student.id).toMatch(/^[0-9a-f-]{36}$/)
    })
  }, 120_000)

  it("is idempotent on the same subject_claim and reports created: false", async () => {
    await withDatabase(async (pool) => {
      const first = await upsertStudentBySubject(pool, IDENTITY)
      const second = await upsertStudentBySubject(pool, IDENTITY)

      expect(first.created).toBe(true)
      expect(second.created).toBe(false)
      // Same row, not a second one.
      expect(second.student.id).toBe(first.student.id)

      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*) AS count FROM student",
      )
      expect(Number(rows[0].count)).toBe(1)
    })
  }, 120_000)

  it("updates email and displayName when the identity provider changes them", async () => {
    await withDatabase(async (pool) => {
      const first = await upsertStudentBySubject(pool, IDENTITY)
      const second = await upsertStudentBySubject(pool, {
        ...IDENTITY,
        email: "thomas@example.com",
        displayName: "Thomas",
        pictureUrl: "https://example.com/t.png",
      })

      expect(second.created).toBe(false)
      expect(second.student.id).toBe(first.student.id)
      expect(second.student.email).toBe("thomas@example.com")
      expect(second.student.displayName).toBe("Thomas")
      expect(second.student.pictureUrl).toBe("https://example.com/t.png")
    })
  }, 120_000)

  it("finds a student by subject and returns null for an unknown subject", async () => {
    await withDatabase(async (pool) => {
      await upsertStudentBySubject(pool, IDENTITY)

      const found = await findStudentBySubject(pool, IDENTITY.subjectClaim)
      expect(found?.email).toBe(IDENTITY.email)

      expect(await findStudentBySubject(pool, "nobody")).toBeNull()
    })
  }, 120_000)
})
