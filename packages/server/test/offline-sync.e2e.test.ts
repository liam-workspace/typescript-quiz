import type { PgPool } from "@liam-workspace/node-postgres"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { OfflineJournalEvent } from "../src/attempts/offline-sync-request.schema.js"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { createTestApp, type TestApp } from "./helpers/app.js"
import {
  seedOfflineFixture,
  type OfflineFixture,
} from "./helpers/offline-fixture.js"

const NOW = new Date("2026-11-22T12:00:00.000Z")
const ago = (seconds: number): string =>
  new Date(NOW.getTime() - seconds * 1000).toISOString()

interface SyncBody {
  attemptId: string
  ackedThrough: number
  applied: number
  late: number
  rejected: number
  answersAcked: number
  finalized: { status: string; resultUrl: string } | null
}

interface ProblemBody {
  type: string
  status: number
  reason?: string
  retryable?: boolean
  capturedAs?: string
}

/**
 * One armed fault: the `remaining`-th query whose SQL matches throws, once.
 * Simulates a crash at an exact point inside the sync's transaction.
 */
interface ArmedFault {
  matches: (sql: string) => boolean
  remaining: number
}

describe("POST /attempts/offline-sync", () => {
  let app: TestApp | undefined = undefined
  let fx: OfflineFixture | undefined = undefined
  let other: OfflineFixture | undefined = undefined
  let pool: PgPool | undefined = undefined
  let fault: ArmedFault | null = null

  beforeAll(async () => {
    app = await createTestApp({
      now: NOW,
      beforePoolQuery: (sql) => {
        if (fault?.matches(sql)) {
          fault.remaining -= 1

          if (fault.remaining === 0) {
            fault = null

            return Promise.reject(new Error("simulated crash"))
          }
        }

        return Promise.resolve()
      },
    })
    pool = app.get<PgPool>(REQUEST_POOL)
    fx = await seedOfflineFixture(app, "offline-sync")
    other = await seedOfflineFixture(app, "offline-sync-other")
  })

  afterAll(async () => {
    await app?.close()
  })

  const a = (): TestApp => {
    if (!app) {
      throw new Error("not ready")
    }

    return app
  }
  const f = (): OfflineFixture => {
    if (!fx) {
      throw new Error("not ready")
    }

    return fx
  }
  const o = (): OfflineFixture => {
    if (!other) {
      throw new Error("not ready")
    }

    return other
  }
  const db = (): PgPool => {
    if (!pool) {
      throw new Error("not ready")
    }

    return pool
  }

  async function student(sub: string): Promise<string> {
    const token = await a().mint({ sub, email: `${sub}@example.com` })

    await request(a().http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    return token
  }

  function sync(
    token: string,
    attemptId: string,
    events: OfflineJournalEvent[],
    sentAt = NOW.toISOString(),
  ) {
    return request(a().http.getHttpServer() as App)
      .post("/api/attempts/offline-sync")
      .set("Authorization", `Bearer ${token}`)
      .send({ attemptId, clientSentAt: sentAt, events })
  }

  async function count(sql: string, params: unknown[]): Promise<number> {
    const { rows } = await db().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (${sql}) AS counted`,
      params,
    )

    return rows[0]?.n ?? 0
  }

  async function playCount(attemptId: string): Promise<number | undefined> {
    const { rows } = await db().query<{ play_count: number }>(
      "SELECT play_count FROM stimulus_play WHERE attempt_id = $1",
      [attemptId],
    )

    return rows[0]?.play_count
  }

  async function capturedReasons(attemptId: string): Promise<string[]> {
    const { rows } = await db().query<{ reason: string }>(
      "SELECT reason FROM failed_write WHERE attempt_id = $1 ORDER BY received_at, id",
      [attemptId],
    )

    return rows.map((row) => row.reason)
  }

  function questions(fixture: OfflineFixture) {
    const l1 = fixture.listening.questions.at(0)
    const l2 = fixture.listening.questions.at(1)
    const r1 = fixture.reading.questions.at(0)

    if (!l1 || !l2 || !r1) {
      throw new Error("fixture questions missing")
    }

    return { l1, l2, r1 }
  }

  /** Start → listening (play, 2 answers, move, finish) → reading (1 answer), all within the last 20 minutes. */
  function journey(attemptId: string): OfflineJournalEvent[] {
    const { listening, reading } = f()
    const { l1, l2, r1 } = questions(f())
    const at = (s: number, seq: number) => ({
      eventSeq: seq,
      clientAt: ago(s),
    })

    return [
      {
        ...at(1140, 1),
        type: "start",
        payload: { slug: f().slug, testVersionId: f().versionId },
      },
      {
        ...at(1130, 2),
        type: "enter_section",
        payload: { sectionId: listening.sectionId },
      },
      {
        ...at(1120, 3),
        type: "play",
        payload: { stimulusId: listening.stimulusId },
      },
      {
        ...at(1110, 4),
        type: "answer",
        payload: {
          sectionId: listening.sectionId,
          questionId: l1.id,
          clientInstanceId: attemptId,
          seq: 1,
          selectedChoiceIds: [l1.choiceIds[0] ?? ""],
        },
      },
      {
        ...at(1100, 5),
        type: "position",
        payload: { sectionId: listening.sectionId, questionId: l2.id },
      },
      {
        ...at(1090, 6),
        type: "answer",
        payload: {
          sectionId: listening.sectionId,
          questionId: l2.id,
          clientInstanceId: attemptId,
          seq: 2,
          selectedChoiceIds: [l2.choiceIds[0] ?? ""],
        },
      },
      {
        ...at(1080, 7),
        type: "finish_section",
        payload: { sectionId: listening.sectionId },
      },
      {
        ...at(1070, 8),
        type: "enter_section",
        payload: { sectionId: reading.sectionId },
      },
      {
        ...at(1060, 9),
        type: "answer",
        payload: {
          sectionId: reading.sectionId,
          questionId: r1.id,
          clientInstanceId: attemptId,
          seq: 3,
          selectedChoiceIds: [r1.choiceIds[0] ?? ""],
        },
      },
    ]
  }

  it("adopts the client uuid, replays the whole journey, and the attempt can then be submitted", async () => {
    const token = await student("sync-happy")
    const attemptId = randomUUID()
    const res = await sync(token, attemptId, journey(attemptId)).expect(200)
    const body = res.body as SyncBody

    expect(body).toEqual({
      attemptId,
      ackedThrough: 9,
      applied: 9,
      late: 0,
      rejected: 0,
      answersAcked: 3,
      finalized: null,
    })

    const { rows } = await db().query<{ origin: string; status: string }>(
      "SELECT origin, status FROM attempt WHERE id = $1",
      [attemptId],
    )

    expect(rows[0]).toEqual({ origin: "offline", status: "in_progress" })
    expect(await playCount(attemptId)).toBe(1)
    expect(await capturedReasons(attemptId)).toEqual([])

    await request(a().http.getHttpServer() as App)
      .post(`/api/attempts/${attemptId}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ clientInstanceId: attemptId, responses: [] })
      .expect(201)
    const result = await request(a().http.getHttpServer() as App)
      .get(`/api/attempts/${attemptId}/result`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    expect((result.body as { score: { correct: number } }).score.correct).toBe(
      3,
    )
  })

  it("is idempotent and supports incremental sync via the cursor", async () => {
    const token = await student("sync-incremental")
    const attemptId = randomUUID()
    const events = journey(attemptId)
    const first = await sync(token, attemptId, events.slice(0, 4)).expect(200)
    const second = await sync(token, attemptId, events).expect(200)
    const again = await sync(token, attemptId, events).expect(200)
    const suffixOnly = await sync(token, attemptId, events.slice(6)).expect(200)

    expect((first.body as SyncBody).ackedThrough).toBe(4)

    // A device that mirrors the attempt now (after every sync above) must
    // continue its journal at seq 10.
    const mirrored = await request(a().http.getHttpServer() as App)
      .get(`/api/attempts/${attemptId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    expect(mirrored.body).toMatchObject({ offlineJournalCursor: 9 })
    expect(second.body).toMatchObject({
      ackedThrough: 9,
      applied: 5,
      answersAcked: 2,
    })
    expect(again.body).toMatchObject({
      ackedThrough: 9,
      applied: 0,
      late: 0,
      rejected: 0,
      answersAcked: 0,
    })
    expect(suffixOnly.body).toMatchObject({ ackedThrough: 9, applied: 0 })
    expect(await playCount(attemptId)).toBe(1)
    expect(
      await count("SELECT 1 FROM response WHERE attempt_id = $1", [attemptId]),
    ).toBe(3)
    expect(
      await count("SELECT 1 FROM attempt_section WHERE attempt_id = $1", [
        attemptId,
      ]),
    ).toBe(2)
  })

  it("serialises two concurrent syncs of the same new journal: one applies, the other acknowledges", async () => {
    const token = await student("sync-concurrent")
    const attemptId = randomUUID()
    const events = journey(attemptId)
    const [one, two] = await Promise.all([
      sync(token, attemptId, events),
      sync(token, attemptId, events),
    ])

    expect([one.status, two.status]).toEqual([200, 200])

    const applied = [one.body as SyncBody, two.body as SyncBody]
      .map((body) => body.applied)
      .sort((x, y) => x - y)

    expect(applied).toEqual([0, 9])
    expect(await playCount(attemptId)).toBe(1)
  })

  it("serialises two concurrent increments of an adopted attempt: the play is claimed once, never refused", async () => {
    const token = await student("sync-concurrent-increment")
    const attemptId = randomUUID()
    const events = journey(attemptId)

    await sync(token, attemptId, events.slice(0, 2)).expect(200)

    const [one, two] = await Promise.all([
      sync(token, attemptId, events.slice(0, 4)),
      sync(token, attemptId, events.slice(0, 4)),
    ])
    const bodies = [one.body as SyncBody, two.body as SyncBody]

    expect([one.status, two.status]).toEqual([200, 200])
    expect(bodies.map((body) => body.applied).sort((x, y) => x - y)).toEqual([
      0, 2,
    ])
    expect(bodies.map((body) => body.rejected)).toEqual([0, 0])
    expect(await playCount(attemptId)).toBe(1)
    expect(await capturedReasons(attemptId)).toEqual([])
  })

  it("refuses ONLY the over-cap play of a journal that plays a capped recording twice: the rest lands, the play is captured, and not counted", async () => {
    const token = await student("sync-playcap")
    const attemptId = randomUUID()
    const { listening } = f()
    const { l1 } = questions(f())
    const events = journey(attemptId).slice(0, 3)
    const second: OfflineJournalEvent = {
      eventSeq: 4,
      clientAt: ago(1115),
      type: "play",
      payload: { stimulusId: listening.stimulusId },
    }
    const answerAfter: OfflineJournalEvent = {
      eventSeq: 5,
      clientAt: ago(1110),
      type: "answer",
      payload: {
        sectionId: listening.sectionId,
        questionId: l1.id,
        clientInstanceId: attemptId,
        seq: 1,
        selectedChoiceIds: [l1.choiceIds[0] ?? ""],
      },
    }
    const res = await sync(token, attemptId, [
      ...events,
      second,
      answerAfter,
    ]).expect(200)

    expect(res.body as SyncBody).toMatchObject({
      ackedThrough: 5,
      applied: 4,
      rejected: 1,
      late: 0,
      answersAcked: 1,
    })
    expect(await playCount(attemptId)).toBe(1)
    expect(await capturedReasons(attemptId)).toEqual([
      "offline_play_cap_exceeded",
    ])
    expect(
      await count(
        "SELECT 1 FROM response WHERE attempt_id = $1 AND question_id = $2",
        [attemptId, l1.id],
      ),
    ).toBe(1)
  })

  it("records an answer after the section deadline as late, captures it, and does not apply it", async () => {
    const token = await student("sync-late")
    const attemptId = randomUUID()
    const { listening } = f()
    const { l1, l2 } = questions(f())
    const events: OfflineJournalEvent[] = [
      {
        eventSeq: 1,
        clientAt: ago(900),
        type: "start",
        payload: { slug: f().slug, testVersionId: f().versionId },
      },
      {
        eventSeq: 2,
        clientAt: ago(890),
        type: "enter_section",
        payload: { sectionId: listening.sectionId },
      },
      {
        eventSeq: 3,
        clientAt: ago(800),
        type: "answer",
        payload: {
          sectionId: listening.sectionId,
          questionId: l1.id,
          clientInstanceId: attemptId,
          seq: 1,
          selectedChoiceIds: [l1.choiceIds[0] ?? ""],
        },
      },
      // 890 - 600 = 290 s ago is the section deadline; an answer 100 s ago is after it.
      {
        eventSeq: 4,
        clientAt: ago(100),
        type: "answer",
        payload: {
          sectionId: listening.sectionId,
          questionId: l2.id,
          clientInstanceId: attemptId,
          seq: 2,
          selectedChoiceIds: [l2.choiceIds[0] ?? ""],
        },
      },
    ]
    const res = await sync(token, attemptId, events).expect(200)

    expect(res.body).toMatchObject({
      ackedThrough: 4,
      applied: 3,
      late: 1,
      rejected: 0,
      answersAcked: 1,
    })
    expect(
      await count("SELECT 1 FROM response WHERE attempt_id = $1", [attemptId]),
    ).toBe(1)
    expect(await capturedReasons(attemptId)).toEqual(["offline_late"])
  })

  it("rejects a forbidden answer change per event, keeps the rest of the journal, and captures it", async () => {
    const token = await student("sync-answer-change")
    const attemptId = randomUUID()
    const { l1 } = questions(f())
    const events = journey(attemptId).slice(0, 4)
    const change: OfflineJournalEvent = {
      eventSeq: 5,
      clientAt: ago(1105),
      type: "answer",
      payload: {
        sectionId: f().listening.sectionId,
        questionId: l1.id,
        clientInstanceId: attemptId,
        seq: 2,
        selectedChoiceIds: [l1.choiceIds[1] ?? ""],
      },
    }
    const res = await sync(token, attemptId, [...events, change]).expect(200)

    expect(res.body).toMatchObject({
      ackedThrough: 5,
      applied: 4,
      rejected: 1,
      answersAcked: 1,
    })
    expect(await capturedReasons(attemptId)).toEqual([
      "offline_answer_change_not_allowed",
    ])

    const { rows } = await db().query<{ choice_id: string }>(
      "SELECT choice_id FROM response_choice WHERE attempt_id = $1",
      [attemptId],
    )

    expect(rows.map((row) => row.choice_id)).toEqual([l1.choiceIds[0]])
  })

  it("rejects an answer behind the forward-only position without applying it", async () => {
    const token = await student("sync-nav-locked")
    const attemptId = randomUUID()
    const { l1 } = questions(f())
    const events = journey(attemptId).slice(0, 5)
    const behind: OfflineJournalEvent = {
      eventSeq: 6,
      clientAt: ago(1095),
      type: "answer",
      payload: {
        sectionId: f().listening.sectionId,
        questionId: l1.id,
        clientInstanceId: attemptId,
        seq: 9,
        selectedChoiceIds: [l1.choiceIds[0] ?? ""],
      },
    }
    const withoutFirstAnswer = events.filter((event) => event.eventSeq !== 4)
    const renumbered = [...withoutFirstAnswer, behind].map((event, index) => ({
      ...event,
      eventSeq: index + 1,
    }))
    const res = await sync(token, attemptId, renumbered).expect(200)

    expect(res.body).toMatchObject({ applied: 4, rejected: 1, answersAcked: 0 })
    expect(
      await count("SELECT 1 FROM response WHERE attempt_id = $1", [attemptId]),
    ).toBe(0)
    expect(await capturedReasons(attemptId)).toEqual([
      "offline_navigation_locked",
    ])
  })

  it("403s a journal for another student's attempt id, applies nothing, and captures it", async () => {
    const owner = await student("sync-owner")
    const intruder = await student("sync-intruder")
    const attemptId = randomUUID()

    await sync(owner, attemptId, journey(attemptId)).expect(200)

    const withStart = await sync(
      intruder,
      attemptId,
      journey(attemptId),
    ).expect(403)
    const noStart = await sync(
      intruder,
      attemptId,
      journey(attemptId)
        .slice(1)
        .map((event) => ({ ...event, eventSeq: event.eventSeq + 8 })),
    ).expect(403)

    expect((withStart.body as ProblemBody).type).toBe("not_your_attempt")
    expect((noStart.body as ProblemBody).type).toBe("not_your_attempt")
    expect(
      await count("SELECT 1 FROM response WHERE attempt_id = $1", [attemptId]),
    ).toBe(3)
    expect(await playCount(attemptId)).toBe(1)

    const { rows } = await db().query<{ last_event_seq: number }>(
      "SELECT last_event_seq FROM offline_journal_cursor WHERE attempt_id = $1",
      [attemptId],
    )

    expect(rows[0]?.last_event_seq).toBe(9)
    expect(await capturedReasons(attemptId)).toEqual([
      "not_your_attempt",
      "not_your_attempt",
    ])
  })

  it("409s when the student already has a live timed attempt on the same version", async () => {
    const token = await student("sync-conflict")

    const started = await request(a().http.getHttpServer() as App)
      .post("/api/attempts")
      .set("Authorization", `Bearer ${token}`)
      .send({ slug: f().slug })
    const { id } = started.body as { id: string }

    await request(a().http.getHttpServer() as App)
      .post(`/api/attempts/${id}/sections/${f().listening.sectionId}/enter`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    const attemptId = randomUUID()
    const res = await sync(token, attemptId, journey(attemptId)).expect(409)

    expect((res.body as ProblemBody).type).toBe("offline_attempt_conflict")
    expect(
      await count("SELECT 1 FROM attempt WHERE id = $1", [attemptId]),
    ).toBe(0)
    expect(await capturedReasons(attemptId)).toEqual([
      "offline_attempt_conflict",
    ])
  })

  it("finalizes as expired when the whole-attempt clock ran out while offline", async () => {
    const token = await student("sync-expired")
    const attemptId = randomUUID()
    const { listening } = f()
    const { l1 } = questions(f())
    const events: OfflineJournalEvent[] = [
      {
        eventSeq: 1,
        clientAt: ago(3 * 3600),
        type: "start",
        payload: { slug: f().slug, testVersionId: f().versionId },
      },
      {
        eventSeq: 2,
        clientAt: ago(3 * 3600 - 10),
        type: "enter_section",
        payload: { sectionId: listening.sectionId },
      },
      {
        eventSeq: 3,
        clientAt: ago(3 * 3600 - 60),
        type: "answer",
        payload: {
          sectionId: listening.sectionId,
          questionId: l1.id,
          clientInstanceId: attemptId,
          seq: 1,
          selectedChoiceIds: [l1.choiceIds[0] ?? ""],
        },
      },
    ]
    const res = await sync(token, attemptId, events).expect(200)
    const body = res.body as SyncBody

    expect(body).toMatchObject({ applied: 3, answersAcked: 1 })
    expect(body.finalized).toEqual({
      status: "expired",
      resultUrl: `/attempts/${attemptId}/result`,
    })

    const result = await request(a().http.getHttpServer() as App)
      .get(`/api/attempts/${attemptId}/result`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    expect((result.body as { score: { correct: number } }).score.correct).toBe(
      1,
    )
  })

  it("records every event for an already-submitted attempt as late and reports where the result is", async () => {
    const token = await student("sync-finished")
    const attemptId = randomUUID()
    const events = journey(attemptId)

    await sync(token, attemptId, events.slice(0, 4)).expect(200)
    await request(a().http.getHttpServer() as App)
      .post(`/api/attempts/${attemptId}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ clientInstanceId: attemptId, responses: [] })
      .expect(201)

    const res = await sync(token, attemptId, events).expect(200)

    expect(res.body).toEqual({
      attemptId,
      ackedThrough: 9,
      applied: 0,
      late: 5,
      rejected: 0,
      answersAcked: 0,
      finalized: {
        status: "submitted",
        resultUrl: `/attempts/${attemptId}/result`,
      },
    })
    expect(
      await count("SELECT 1 FROM response WHERE attempt_id = $1", [attemptId]),
    ).toBe(1)
  })

  it("422s a start naming an unknown version, or a real version under another test's slug", async () => {
    const token = await student("sync-version")
    const unknownId = randomUUID()
    const unknown = journey(unknownId).slice(0, 1)
    const startOf = (event: OfflineJournalEvent | undefined) => {
      if (event?.type !== "start") {
        throw new Error("expected a start event")
      }

      return event
    }
    const unknownStart = startOf(unknown[0])
    const res = await sync(token, unknownId, [
      {
        ...unknownStart,
        payload: { slug: f().slug, testVersionId: randomUUID() },
      },
    ]).expect(422)

    expect(res.body).toMatchObject({
      type: "offline_journal_invalid",
      reason: "version_unavailable",
    })

    const foreignId = randomUUID()
    const foreign = await sync(token, foreignId, [
      {
        ...unknownStart,
        payload: { slug: f().slug, testVersionId: o().versionId },
      },
    ]).expect(422)

    expect(foreign.body).toMatchObject({
      type: "offline_journal_invalid",
      reason: "version_unavailable",
    })
    expect(
      await count("SELECT 1 FROM attempt WHERE id = ANY($1::uuid[])", [
        [unknownId, foreignId],
      ]),
    ).toBe(0)
    expect(await capturedReasons(unknownId)).toEqual([
      "offline_journal_invalid",
    ])
  })

  it("422s ids from another version on an existing attempt: the version comes from the attempt row", async () => {
    const token = await student("sync-foreign-ids")
    const attemptId = randomUUID()

    await sync(token, attemptId, journey(attemptId).slice(0, 2)).expect(200)

    const res = await sync(token, attemptId, [
      {
        eventSeq: 3,
        clientAt: ago(1120),
        type: "play",
        payload: { stimulusId: o().listening.stimulusId },
      },
    ]).expect(422)

    expect(res.body).toMatchObject({
      type: "offline_journal_invalid",
      reason: "unknown_stimulus",
    })
    expect(await playCount(attemptId)).toBeUndefined()
  })

  it("422s a journal with a gap, captures it, and 401s without a token", async () => {
    const token = await student("sync-invalid")
    const attemptId = randomUUID()
    const events = journey(attemptId)
    const gap = [events.at(0), events.at(2)].filter(
      (e): e is OfflineJournalEvent => e !== undefined,
    )
    const res = await sync(token, attemptId, gap).expect(422)

    expect(res.body).toMatchObject({
      type: "offline_journal_invalid",
      reason: "event_seq_not_contiguous",
      retryable: false,
    })
    expect(await capturedReasons(attemptId)).toEqual([
      "offline_journal_invalid",
    ])

    await request(a().http.getHttpServer() as App)
      .post("/api/attempts/offline-sync")
      .send({ attemptId, clientSentAt: NOW.toISOString(), events })
      .expect(401)
  })

  it("400s a body that fails the request schema and 413s an oversized one, capturing both", async () => {
    const token = await student("sync-body")
    const before = await count(
      "SELECT 1 FROM failed_write WHERE route LIKE '%/offline-sync%'",
      [],
    )

    await request(a().http.getHttpServer() as App)
      .post("/api/attempts/offline-sync")
      .set("Authorization", `Bearer ${token}`)
      .send({ attemptId: randomUUID(), events: [] })
      .expect(400)
    await request(a().http.getHttpServer() as App)
      .post("/api/attempts/offline-sync")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ padding: "x".repeat(300_000) }))
      .expect(413)

    expect(
      await count(
        "SELECT 1 FROM failed_write WHERE route LIKE '%/offline-sync%'",
        [],
      ),
    ).toBe(before + 2)
  })

  it("survives a crash after the attempt is created but before the cursor is written: nothing half-adopted, the retry applies once", async () => {
    const token = await student("sync-crash-cursor")
    const attemptId = randomUUID()
    const events = journey(attemptId)

    fault = {
      matches: (sql) => sql.includes("INSERT INTO offline_journal_cursor"),
      remaining: 1,
    }

    const crashed = await sync(token, attemptId, events).expect(500)

    expect(crashed.body).toMatchObject({
      type: "unexpected_error",
      retryable: true,
    })
    expect((crashed.body as ProblemBody).capturedAs).toEqual(expect.any(String))
    expect(
      await count("SELECT 1 FROM attempt WHERE id = $1", [attemptId]),
    ).toBe(0)

    const retried = await sync(token, attemptId, events).expect(200)

    expect(retried.body).toMatchObject({ ackedThrough: 9, applied: 9 })
    expect(await playCount(attemptId)).toBe(1)
  })

  it("survives a crash after a play was applied: the retry does not double-count it into a play-cap refusal", async () => {
    const token = await student("sync-crash-play")
    const attemptId = randomUUID()
    const events = journey(attemptId)

    fault = {
      matches: (sql) => sql.includes("INSERT INTO response_choice"),
      remaining: 1,
    }

    await sync(token, attemptId, events).expect(500)

    const retried = await sync(token, attemptId, events).expect(200)

    expect(retried.body).toMatchObject({
      ackedThrough: 9,
      applied: 9,
      rejected: 0,
    })
    expect(await playCount(attemptId)).toBe(1)
    expect(await capturedReasons(attemptId)).toEqual(["unexpected_error"])
  })
})
