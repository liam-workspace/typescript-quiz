import { describe, expect, it } from "vitest"
import { insertFailedWrite } from "../src/repositories/failed-write.repository.js"
import { withDatabase } from "./helpers/database.js"

const NOW = new Date("2026-08-27T09:00:00.000Z")

describe("failed_write repository", () => {
  it("stores a captured write and round-trips every field", async () => {
    await withDatabase(async (pool) => {
      const row = await insertFailedWrite(pool, {
        attemptId: "11111111-1111-1111-1111-111111111111",
        route: "PATCH /attempts/x/responses",
        reason: "mixed_sections",
        rawBody: '{"clientInstanceId":"c1","responses":[]}',
        byteSize: 42,
        clientVersion: "1.0.0",
        clientInstanceId: "c1",
        now: NOW,
      })

      expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(row.attemptId).toBe("11111111-1111-1111-1111-111111111111")
      expect(row.route).toBe("PATCH /attempts/x/responses")
      expect(row.reason).toBe("mixed_sections")
      expect(row.rawBody).toBe('{"clientInstanceId":"c1","responses":[]}')
      expect(row.byteSize).toBe(42)
      expect(row.clientVersion).toBe("1.0.0")
      expect(row.clientInstanceId).toBe("c1")
      expect(row.receivedAt).toEqual(NOW)
      expect(row.replayedAt).toBeNull()
    })
  }, 120_000)

  it("accepts a null attemptId for a body malformed before any id could be read", async () => {
    await withDatabase(async (pool) => {
      const row = await insertFailedWrite(pool, {
        attemptId: null,
        route: "PATCH /attempts/x/responses",
        reason: "unparseable_body",
        rawBody: "{not json",
        byteSize: 9,
        clientVersion: null,
        clientInstanceId: null,
        now: NOW,
      })

      expect(row.attemptId).toBeNull()
    })
  }, 120_000)

  it("captures a body with no parseable structure at all, verbatim (the oversized/413 raw-bytes path)", async () => {
    await withDatabase(async (pool) => {
      // Not JSON, not any recognizable shape -- this is the
      // fallback-to-raw-bytes case: nothing about the payload parsed, so
      // there is no field to extract an attemptId from, and the only thing
      // worth keeping is the raw body verbatim.
      const garbage = "not json at all, just noise: <<>> ### 999 ]][["
      const row = await insertFailedWrite(pool, {
        attemptId: null,
        route: "PATCH /attempts/x/responses",
        reason: "oversized_payload",
        rawBody: garbage,
        byteSize: Buffer.byteLength(garbage),
        clientVersion: null,
        clientInstanceId: null,
        now: NOW,
      })

      expect(row.rawBody).toBe(garbage)
      expect(row.reason).toBe("oversized_payload")
      expect(row.attemptId).toBeNull()
      expect(typeof row.byteSize).toBe("number")
    })
  }, 120_000)

  it("captures a body containing a NUL byte instead of throwing", async () => {
    await withDatabase(async (pool) => {
      // A truncated upload or a binary body sent to a JSON route carries
      // NULs, and Postgres text rejects them outright with
      // `invalid byte sequence for encoding "UTF8": 0x00`. Those are exactly
      // the payloads most likely to be refused, so an unsanitised capture
      // throws precisely when it is most needed.
      const binaryish = `head${String.fromCharCode(0)}tail`

      const row = await insertFailedWrite(pool, {
        attemptId: null,
        route: "/api/attempts/x/responses",
        reason: "unparseable",
        rawBody: binaryish,
        byteSize: binaryish.length,
        clientVersion: null,
        clientInstanceId: null,
        now: new Date("2026-08-27T00:00:00.000Z"),
      })

      expect(row.rawBody).toBe("head\\x00tail")
      // The ORIGINAL length survives, so a reader can tell the body was
      // binary rather than assuming it was short.
      expect(row.byteSize).toBe(binaryish.length)
    })
  }, 120_000)
})
