import { randomUUID } from "node:crypto"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import {
  loadResponse,
  writeResponse,
} from "../src/repositories/response.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest, type Fixture } from "./helpers/fixtures.js"

const NOW = new Date("2026-08-27T09:00:00.000Z")

async function insertAttempt(pool: pg.Pool, fixture: Fixture): Promise<string> {
  const attemptId = randomUUID()
  await pool.query(
    `INSERT INTO attempt (id, student_id, test_version_id, status)
     VALUES ($1, $2, $3, 'in_progress')`,
    [attemptId, fixture.studentId, fixture.versionId],
  )

  return attemptId
}

function baseInput(fixture: Fixture, attemptId: string, questionIndex: 0 | 1) {
  return {
    attemptId,
    questionId: fixture.questionIds[questionIndex],
    testVersionId: fixture.versionId,
    answeredAt: NOW,
    timeSpentMs: 500,
    now: NOW,
  }
}

describe("response repository -- reorder guard", () => {
  it("applies the first write from an instance regardless of its seq value", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)

      const outcome = await writeResponse(pool, {
        ...baseInput(fixture, attemptId, 1),
        clientInstanceId: "device-a",
        seq: 5,
        selectedChoiceIds: [fixture.choiceIds[2]],
        allowAnswerChange: true,
      })

      expect(outcome).toEqual({ kind: "applied" })
      const recorded = await loadResponse(pool, {
        attemptId,
        questionId: fixture.questionIds[1],
      })
      expect(recorded?.selectedChoiceIds).toEqual([fixture.choiceIds[2]])
      expect(recorded?.seq).toBe(5)
    })
  }, 120_000)

  it("DISCARDS a real lower seq from the same instance as stale", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)
      const input = baseInput(fixture, attemptId, 1)

      await writeResponse(pool, {
        ...input,
        clientInstanceId: "device-a",
        seq: 10,
        selectedChoiceIds: [fixture.choiceIds[2]],
        allowAnswerChange: true,
      })

      const stale = await writeResponse(pool, {
        ...input,
        clientInstanceId: "device-a",
        seq: 3,
        selectedChoiceIds: [fixture.choiceIds[3]],
        allowAnswerChange: true,
      })

      expect(stale).toEqual({ kind: "ignored_stale" })
      const recorded = await loadResponse(pool, {
        attemptId,
        questionId: fixture.questionIds[1],
      })
      // The stale write's content never landed -- seq 10's selection stands.
      expect(recorded?.selectedChoiceIds).toEqual([fixture.choiceIds[2]])
      expect(recorded?.seq).toBe(10)
    })
  }, 120_000)

  it("applies a higher seq from the same instance after an earlier one", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)
      const input = baseInput(fixture, attemptId, 1)

      await writeResponse(pool, {
        ...input,
        clientInstanceId: "device-a",
        seq: 1,
        selectedChoiceIds: [fixture.choiceIds[2]],
        allowAnswerChange: true,
      })
      const outcome = await writeResponse(pool, {
        ...input,
        clientInstanceId: "device-a",
        seq: 2,
        selectedChoiceIds: [fixture.choiceIds[3]],
        allowAnswerChange: true,
      })

      expect(outcome).toEqual({ kind: "applied" })
      const recorded = await loadResponse(pool, {
        attemptId,
        questionId: fixture.questionIds[1],
      })
      expect(recorded?.selectedChoiceIds).toEqual([fixture.choiceIds[3]])
    })
  }, 120_000)

  it("judges a different clientInstanceId by its OWN cursor, independent of another instance's seq", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)
      const input = baseInput(fixture, attemptId, 1)

      // Device-a races ahead to a high seq.
      await writeResponse(pool, {
        ...input,
        clientInstanceId: "device-a",
        seq: 900,
        selectedChoiceIds: [fixture.choiceIds[2]],
        allowAnswerChange: true,
      })

      // Device-b's first write ever, seq 1 -- numerically far below
      // device-a's 900, but device-b has no cursor of its own yet, so this
      // is accepted: arrival order across instances, not a shared seq space.
      const outcome = await writeResponse(pool, {
        ...input,
        clientInstanceId: "device-b",
        seq: 1,
        selectedChoiceIds: [fixture.choiceIds[3]],
        allowAnswerChange: true,
      })

      expect(outcome).toEqual({ kind: "applied" })
      const recorded = await loadResponse(pool, {
        attemptId,
        questionId: fixture.questionIds[1],
      })
      // Last writer wins across instances -- device-b's write is now the
      // winning row, even though its seq is lower than device-a's.
      expect(recorded?.clientInstanceId).toBe("device-b")
      expect(recorded?.selectedChoiceIds).toEqual([fixture.choiceIds[3]])

      // But device-a's OWN cursor remembers 900: a queued retry of
      // device-a's seq 900 write, arriving late, is still judged stale for
      // device-a's instance even though device-b has since taken over.
      const staleRetry = await writeResponse(pool, {
        ...input,
        clientInstanceId: "device-a",
        seq: 900,
        selectedChoiceIds: [fixture.choiceIds[2]],
        allowAnswerChange: true,
      })
      expect(staleRetry).toEqual({ kind: "ignored_stale" })
    })
  }, 120_000)

  it("treats an identical re-send under allowAnswerChange:false as an idempotent no-op", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)
      // Q1 is the LISTENING question -- allowAnswerChange: false in the fixture.
      const input = baseInput(fixture, attemptId, 0)

      await writeResponse(pool, {
        ...input,
        clientInstanceId: "device-a",
        seq: 1,
        selectedChoiceIds: [fixture.choiceIds[0]],
        allowAnswerChange: false,
      })

      // A network retry re-sends the SAME content at a higher seq (the
      // client's own retry logic incremented seq before resending).
      const retry = await writeResponse(pool, {
        ...input,
        clientInstanceId: "device-a",
        seq: 2,
        selectedChoiceIds: [fixture.choiceIds[0]],
        allowAnswerChange: false,
      })

      expect(retry).toEqual({ kind: "applied" })
    })
  }, 120_000)

  it("rejects a content-CHANGING re-send under allowAnswerChange:false", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)
      const input = baseInput(fixture, attemptId, 0)

      await writeResponse(pool, {
        ...input,
        clientInstanceId: "device-a",
        seq: 1,
        selectedChoiceIds: [fixture.choiceIds[0]],
        allowAnswerChange: false,
      })

      const changed = await writeResponse(pool, {
        ...input,
        clientInstanceId: "device-a",
        seq: 2,
        selectedChoiceIds: [fixture.choiceIds[1]],
        allowAnswerChange: false,
      })

      expect(changed).toEqual({
        kind: "rejected",
        reason: "answer_change_not_allowed",
      })
      // The rejected content never landed -- the original selection stands.
      const recorded = await loadResponse(pool, {
        attemptId,
        questionId: fixture.questionIds[0],
      })
      expect(recorded?.selectedChoiceIds).toEqual([fixture.choiceIds[0]])
    })
  }, 120_000)

  it("rejects an unknown question without throwing", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)

      const outcome = await writeResponse(pool, {
        attemptId,
        questionId: randomUUID(),
        testVersionId: fixture.versionId,
        clientInstanceId: "device-a",
        seq: 1,
        selectedChoiceIds: [],
        answeredAt: NOW,
        timeSpentMs: null,
        allowAnswerChange: true,
        now: NOW,
      })

      expect(outcome).toEqual({
        kind: "rejected",
        reason: "unknown_question",
      })
    })
  }, 120_000)

  it("does not misclassify an unknown attempt as an unknown question", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)

      await expect(
        writeResponse(pool, {
          attemptId: randomUUID(),
          questionId: fixture.questionIds[0],
          testVersionId: fixture.versionId,
          clientInstanceId: "device-a",
          seq: 1,
          selectedChoiceIds: [],
          answeredAt: NOW,
          timeSpentMs: null,
          allowAnswerChange: true,
          now: NOW,
        }),
      ).rejects.toMatchObject({ constraint: "response_attempt_fk" })
    })
  }, 120_000)

  it("an empty selectedChoiceIds clears the answer rather than being rejected as malformed", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertAttempt(pool, fixture)
      const input = baseInput(fixture, attemptId, 1)

      await writeResponse(pool, {
        ...input,
        clientInstanceId: "device-a",
        seq: 1,
        selectedChoiceIds: [fixture.choiceIds[2]],
        allowAnswerChange: true,
      })
      const cleared = await writeResponse(pool, {
        ...input,
        clientInstanceId: "device-a",
        seq: 2,
        selectedChoiceIds: [],
        allowAnswerChange: true,
      })

      expect(cleared).toEqual({ kind: "applied" })
      const recorded = await loadResponse(pool, {
        attemptId,
        questionId: fixture.questionIds[1],
      })
      expect(recorded?.selectedChoiceIds).toEqual([])
    })
  }, 120_000)
})
