import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"

interface AuditRow {
  id: string
  admin_subject: string
  action: string
  resource_type: string
  resource_id: string
  metadata: Record<string, unknown>
  created_at: Date
}

const auditIdentity = [
  "oidc|admin-123",
  "test.updated",
  "test",
  "example-test-slug",
]

const insertAudit = `INSERT INTO admin_audit_log
  (admin_subject, action, resource_type, resource_id)
  VALUES ($1, $2, $3, $4) RETURNING *`

describe("migration 1007 — immutable admin audit log", () => {
  it("appends audit records with JSON metadata and generated identity and timestamp", async () => {
    await withDatabase(async (pool) => {
      // Container and host clocks can differ by a few milliseconds; use
      // PostgreSQL's clock for both bounds of its generated timestamp.
      const before = await pool.query<{ recorded_at: Date }>(
        `SELECT now() AS recorded_at`,
      )
      const { rows } = await pool.query<AuditRow>(
        `INSERT INTO admin_audit_log
         (admin_subject, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [...auditIdentity, { version: 2, changedFields: ["title"] }],
      )
      const [audit] = rows
      expect(audit.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
      expect(audit).toMatchObject({
        admin_subject: "oidc|admin-123",
        action: "test.updated",
        resource_type: "test",
        resource_id: "example-test-slug",
        metadata: { version: 2, changedFields: ["title"] },
      })
      const after = await pool.query<{ recorded_at: Date }>(
        `SELECT now() AS recorded_at`,
      )
      expect(audit.created_at.getTime()).toBeGreaterThanOrEqual(
        before.rows[0].recorded_at.getTime(),
      )
      expect(audit.created_at.getTime()).toBeLessThanOrEqual(
        after.rows[0].recorded_at.getTime(),
      )

      const second = await pool.query<AuditRow>(insertAudit, auditIdentity)
      expect(second.rows[0].id).not.toBe(audit.id)
      const persisted = await pool.query<AuditRow>(
        `SELECT * FROM admin_audit_log WHERE id=$1`,
        [audit.id],
      )
      expect(persisted.rows).toEqual([audit])
    })
  }, 120_000)

  it("defaults omitted metadata to an empty JSON object", async () => {
    await withDatabase(async (pool) => {
      const { rows } = await pool.query<AuditRow>(insertAudit, auditIdentity)
      expect(rows[0].metadata).toEqual({})
    })
  }, 120_000)

  it.each([
    ["UPDATE", "UPDATE admin_audit_log SET metadata='{}' WHERE id=$1"],
    ["DELETE", "DELETE FROM admin_audit_log WHERE id=$1"],
  ])(
    "rejects %s and preserves the original record",
    async (_operation, sql) => {
      await withDatabase(async (pool) => {
        const { rows } = await pool.query<AuditRow>(insertAudit, auditIdentity)
        await expect(pool.query(sql, [rows[0].id])).rejects.toMatchObject({
          code: "23001",
        })
        const persisted = await pool.query<AuditRow>(
          `SELECT * FROM admin_audit_log WHERE id=$1`,
          [rows[0].id],
        )
        expect(persisted.rows).toEqual(rows)
      })
    },
    120_000,
  )

  it.each([
    ["admin_subject", 0],
    ["action", 1],
    ["resource_type", 2],
    ["resource_id", 3],
  ] as const)(
    "requires a nonblank %s",
    async (column, index) => {
      await withDatabase(async (pool) => {
        const pending: Array<Promise<void>> = []
        for (const invalid of [null, "", "   "]) {
          const values: Array<string | null> = [...auditIdentity]
          values[index] = invalid
          pending.push(
            expect(pool.query(insertAudit, values)).rejects.toMatchObject(
              invalid === null
                ? { code: "23502", column }
                : {
                    code: "23514",
                    constraint: `admin_audit_${column}_not_blank`,
                  },
            ),
          )
        }
        await Promise.all(pending)
      })
    },
    120_000,
  )
})
