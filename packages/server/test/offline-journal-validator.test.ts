import type { JournalContextRows } from "@pp/db"
import { describe, expect, it } from "vitest"
import type { OfflineJournalEvent } from "../src/attempts/offline-sync-request.schema.js"
import {
  buildJournalContext,
  FUTURE_TOLERANCE_MS,
  MAX_JOURNAL_AGE_MS,
  validateJournal,
  type JournalContext,
  type JournalSectionState,
  type JournalValidation,
} from "../src/attempts/offline-journal.validator.js"

// Every rule of the validator has at least one test whose name starts with
// the rule's reason code (or disposition), so a failing test names the rule
// it guards.

const RECEIVED = Date.parse("2026-11-22T12:00:00.000Z")
const ago = (seconds: number): string =>
  new Date(RECEIVED - seconds * 1000).toISOString()
const at = (seconds: number): Date => new Date(RECEIVED - seconds * 1000)
const SEC_L = "00000000-0000-4000-8000-0000000000a1"
const SEC_R = "00000000-0000-4000-8000-0000000000a2"
const SEC_M = "00000000-0000-4000-8000-0000000000a3"
const ST_L = "00000000-0000-4000-8000-0000000000b1"
const ST_R = "00000000-0000-4000-8000-0000000000b2"
const QL1 = "00000000-0000-4000-8000-0000000000c1"
const QL2 = "00000000-0000-4000-8000-0000000000c2"
const QR1 = "00000000-0000-4000-8000-0000000000c3"
const QR2 = "00000000-0000-4000-8000-0000000000c4"
const QM1 = "00000000-0000-4000-8000-0000000000c5"
const VER = "00000000-0000-4000-8000-0000000000d1"
const UNKNOWN = "00000000-0000-4000-8000-00000000ffff"

function ctx(over: Partial<JournalContext> = {}): JournalContext {
  return {
    receivedAt: new Date(RECEIVED),
    clientSentAt: new Date(RECEIVED),
    ackedThrough: 0,
    attemptExists: false,
    attemptFinished: false,
    attemptStartedAt: null,
    attemptExpiresAt: null,
    currentPosition: null,
    versionDurationSeconds: 1200,
    sections: new Map([
      [
        SEC_L,
        {
          id: SEC_L,
          ordinal: 1,
          durationSeconds: 600,
          navigation: "forward_only",
          allowAnswerChange: false,
        },
      ],
      [
        SEC_R,
        {
          id: SEC_R,
          ordinal: 2,
          durationSeconds: 600,
          navigation: "free",
          allowAnswerChange: true,
        },
      ],
      [
        SEC_M,
        {
          id: SEC_M,
          ordinal: 3,
          durationSeconds: 300,
          navigation: "free",
          allowAnswerChange: true,
        },
      ],
    ]),
    stimuli: new Map([
      [ST_L, { sectionId: SEC_L, maxPlays: 1 }],
      [ST_R, { sectionId: SEC_R, maxPlays: null }],
    ]),
    questions: new Map([
      [QL1, { sectionId: SEC_L, ordinal: 1 }],
      [QL2, { sectionId: SEC_L, ordinal: 2 }],
      [QR1, { sectionId: SEC_R, ordinal: 3 }],
      [QR2, { sectionId: SEC_R, ordinal: 4 }],
      [QM1, { sectionId: SEC_M, ordinal: 5 }],
    ]),
    playsUsed: new Map(),
    sectionStates: new Map(),
    ...over,
  }
}

const start = (seq: number, s: number): OfflineJournalEvent => ({
  eventSeq: seq,
  type: "start",
  clientAt: ago(s),
  payload: { slug: "p3", testVersionId: VER },
})
const enter = (
  seq: number,
  s: number,
  sectionId: string,
): OfflineJournalEvent => ({
  eventSeq: seq,
  type: "enter_section",
  clientAt: ago(s),
  payload: { sectionId },
})
const play = (
  seq: number,
  s: number,
  stimulusId: string = ST_L,
): OfflineJournalEvent => ({
  eventSeq: seq,
  type: "play",
  clientAt: ago(s),
  payload: { stimulusId },
})
const position = (
  seq: number,
  s: number,
  sectionId: string,
  questionId: string,
): OfflineJournalEvent => ({
  eventSeq: seq,
  type: "position",
  clientAt: ago(s),
  payload: { sectionId, questionId },
})
const answer = (
  seq: number,
  s: number,
  sectionId: string,
  questionId: string,
): OfflineJournalEvent => ({
  eventSeq: seq,
  type: "answer",
  clientAt: ago(s),
  payload: {
    sectionId,
    questionId,
    clientInstanceId: "dev-1",
    seq,
    selectedChoiceIds: ["00000000-0000-4000-8000-0000000000e1"],
  },
})
const finish = (
  seq: number,
  s: number,
  sectionId: string,
): OfflineJournalEvent => ({
  eventSeq: seq,
  type: "finish_section",
  clientAt: ago(s),
  payload: { sectionId },
})

/** Re-stamps every event by `deltaMs`, as a device with a wrong clock would. */
function shifted(
  events: readonly OfflineJournalEvent[],
  deltaMs: number,
): OfflineJournalEvent[] {
  return events.map((event) => ({
    ...event,
    clientAt: new Date(Date.parse(event.clientAt) + deltaMs).toISOString(),
  }))
}

function openState(
  enteredSecondsAgo: number,
  durationSeconds: number,
): JournalSectionState {
  return {
    enteredAt: at(enteredSecondsAgo),
    expiresAt: new Date(
      RECEIVED - enteredSecondsAgo * 1000 + durationSeconds * 1000,
    ),
    completedAt: null,
  }
}

function describeDisposition(
  planned: Extract<JournalValidation, { ok: true }>["planned"][number],
): string {
  return planned.disposition.kind === "rejected"
    ? `rejected:${planned.disposition.reason}`
    : planned.disposition.kind
}

function kinds(result: JournalValidation): string[] {
  if (!result.ok) {
    return [`!${result.code}:${result.reason}`]
  }

  return result.planned.map(describeDisposition)
}

const INVALID = (reason: string): string[] => [
  `!offline_journal_invalid:${reason}`,
]

const CLEAN_JOURNEY: readonly OfflineJournalEvent[] = [
  start(1, 1140),
  enter(2, 1130, SEC_L),
  play(3, 1120),
  answer(4, 1110, SEC_L, QL1),
  position(5, 1100, SEC_L, QL2),
  answer(6, 1090, SEC_L, QL2),
  finish(7, 1080, SEC_L),
  enter(8, 1070, SEC_R),
  answer(9, 1060, SEC_R, QR1),
]

describe("validateJournal — sequence and time (structural)", () => {
  it("apply: accepts a clean journey and plans every event", () => {
    const result = validateJournal(CLEAN_JOURNEY, ctx())

    expect(kinds(result)).toEqual(Array(9).fill("apply"))
  })

  it("acked prefix: ignores events at or below the cursor and requires the rest to be contiguous", () => {
    const events = [
      start(1, 100),
      enter(2, 90, SEC_L),
      play(3, 80),
      answer(4, 70, SEC_L, QL1),
    ]
    const result = validateJournal(
      events,
      ctx({
        ackedThrough: 2,
        attemptExists: true,
        attemptStartedAt: at(90),
        attemptExpiresAt: new Date(RECEIVED - 90_000 + 1_200_000),
        sectionStates: new Map([[SEC_L, openState(90, 600)]]),
      }),
    )

    expect(result.ok && result.planned.map((p) => p.event.eventSeq)).toEqual([
      3, 4,
    ])
  })

  it("acked prefix: replaying a fully acknowledged journal plans nothing (idempotent)", () => {
    const result = validateJournal(
      CLEAN_JOURNEY,
      ctx({ ackedThrough: 9, attemptExists: true }),
    )

    expect(result).toEqual({ ok: true, planned: [] })
  })

  it("acked prefix: an incremental sync (prefix first, then the rest) plans exactly the suffix", () => {
    const first = validateJournal(CLEAN_JOURNEY.slice(0, 4), ctx())

    expect(kinds(first)).toEqual(["apply", "apply", "apply", "apply"])

    // The server has now applied 1-4: L entered 1130 s ago, ST_L played once.
    const second = validateJournal(
      CLEAN_JOURNEY,
      ctx({
        ackedThrough: 4,
        attemptExists: true,
        attemptStartedAt: at(1130),
        attemptExpiresAt: new Date(RECEIVED - 1_130_000 + 1_200_000),
        sectionStates: new Map([[SEC_L, openState(1130, 600)]]),
        playsUsed: new Map([[ST_L, 1]]),
      }),
    )

    expect(second.ok && second.planned.map((p) => p.event.eventSeq)).toEqual([
      5, 6, 7, 8, 9,
    ])
    expect(kinds(second)).toEqual(Array(5).fill("apply"))
  })

  it("event_seq_not_contiguous: rejects a gap", () => {
    const result = validateJournal([start(1, 100), enter(3, 90, SEC_L)], ctx())

    expect(kinds(result)).toEqual(INVALID("event_seq_not_contiguous"))
    expect(result).toMatchObject({ eventSeq: 3 })
  })

  it("event_seq_not_contiguous: rejects a duplicated eventSeq", () => {
    const events = [start(1, 100), enter(2, 90, SEC_L), play(2, 80)]

    expect(kinds(validateJournal(events, ctx()))).toEqual(
      INVALID("event_seq_not_contiguous"),
    )
  })

  it("event_seq_not_contiguous: rejects events sent out of order", () => {
    const events = [start(1, 100), play(3, 80), enter(2, 90, SEC_L)]

    expect(kinds(validateJournal(events, ctx()))).toEqual(
      INVALID("event_seq_not_contiguous"),
    )
  })

  it("event_seq_not_contiguous: rejects a suffix that skips past the cursor", () => {
    const result = validateJournal(
      [play(4, 80), answer(5, 70, SEC_L, QL1)],
      ctx({ ackedThrough: 2, attemptExists: true }),
    )

    expect(kinds(result)).toEqual(INVALID("event_seq_not_contiguous"))
  })

  it("client_at_backwards: rejects clientAt decreasing", () => {
    expect(
      kinds(validateJournal([start(1, 100), enter(2, 200, SEC_L)], ctx())),
    ).toEqual(INVALID("client_at_backwards"))
  })

  it("client_at_backwards: equal clientAt values are allowed (non-decreasing)", () => {
    expect(
      kinds(validateJournal([start(1, 100), enter(2, 100, SEC_L)], ctx())),
    ).toEqual(["apply", "apply"])
  })

  it("client_at_after_sent_at: rejects an event stamped after the device's own send time plus tolerance", () => {
    const sentEarlier = ctx({ clientSentAt: new Date(RECEIVED - 600_000) })

    expect(kinds(validateJournal([start(1, 100)], sentEarlier))).toEqual(
      INVALID("client_at_after_sent_at"),
    )
  })

  it("client_at_after_sent_at: jitter inside the tolerance is accepted but never lands after receipt", () => {
    const events: OfflineJournalEvent[] = [
      {
        ...start(1, 0),
        clientAt: new Date(RECEIVED + FUTURE_TOLERANCE_MS - 1).toISOString(),
      },
    ]
    const result = validateJournal(events, ctx())

    expect(kinds(result)).toEqual(["apply"])
    expect(result.ok && result.planned[0]?.effectiveAt.getTime()).toBe(RECEIVED)
  })

  it("client_at_after_sent_at: an absurdly future clientAt is refused", () => {
    const events: OfflineJournalEvent[] = [
      { ...start(1, 0), clientAt: "9999-12-31T23:59:59.000Z" },
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual(
      INVALID("client_at_after_sent_at"),
    )
  })

  it("event_too_old: rejects an event older than 72 hours", () => {
    expect(kinds(validateJournal([start(1, 73 * 3600)], ctx()))).toEqual(
      INVALID("event_too_old"),
    )
  })

  it("event_too_old: accepts a journal just inside 72 hours", () => {
    const seconds = MAX_JOURNAL_AGE_MS / 1000 - 1

    expect(kinds(validateJournal([start(1, seconds)], ctx()))).toEqual([
      "apply",
    ])
  })

  it("event_too_old: an absurdly old clientAt against an honest clientSentAt is refused", () => {
    const events: OfflineJournalEvent[] = [
      { ...start(1, 0), clientAt: "1970-01-01T00:00:00.000Z" },
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual(
      INVALID("event_too_old"),
    )
  })

  it("skew: normalises a fast device clock instead of rejecting the attempt", () => {
    const deviceAhead = 600_000
    const events: OfflineJournalEvent[] = [
      {
        eventSeq: 1,
        type: "start",
        clientAt: new Date(RECEIVED + deviceAhead - 300_000).toISOString(),
        payload: { slug: "p3", testVersionId: VER },
      },
    ]
    const result = validateJournal(
      events,
      ctx({ clientSentAt: new Date(RECEIVED + deviceAhead) }),
    )

    expect(result.ok && result.planned[0]?.effectiveAt.toISOString()).toBe(
      new Date(RECEIVED - 300_000).toISOString(),
    )
  })

  it("skew: normalises a slow device clock the same way", () => {
    const deviceBehind = -600_000
    const result = validateJournal(
      shifted(CLEAN_JOURNEY, deviceBehind),
      ctx({ clientSentAt: new Date(RECEIVED + deviceBehind) }),
    )

    expect(result.ok && result.planned.map((p) => p.effectiveAt)).toEqual(
      CLEAN_JOURNEY.map((event) => new Date(event.clientAt)),
    )
  })

  it("skew: a device clock reset to 1970 is normalised when it is self-consistent", () => {
    const toEpoch = -RECEIVED
    const result = validateJournal(
      shifted(CLEAN_JOURNEY, toEpoch),
      ctx({ clientSentAt: new Date(0) }),
    )

    expect(kinds(result)).toEqual(Array(9).fill("apply"))
  })

  it("skew: a wrong clock neither gains nor loses time — dispositions are skew-invariant", () => {
    // L entered 3590 s ago; the answer 660 s later is late on a 600 s clock.
    const events = [
      start(1, 3600),
      enter(2, 3590, SEC_L),
      answer(3, 3590 - 590, SEC_L, QL1),
      answer(4, 3590 - 660, SEC_L, QL2),
    ]
    const expected = ["apply", "apply", "apply", "late"]

    for (const skew of [-86_400_000, -600_000, 0, 600_000, 86_400_000]) {
      const result = validateJournal(
        shifted(events, skew),
        ctx({
          clientSentAt: new Date(RECEIVED + skew),
          versionDurationSeconds: 7200,
        }),
      )

      expect(kinds(result), `skew ${skew}`).toEqual(expected)
    }
  })

  it("floor clamp: an event claiming to precede the server's recorded history is moved up to it", () => {
    const state = new Map([[SEC_L, openState(120, 600)]])
    const result = validateJournal(
      [answer(1, 300, SEC_L, QL1)],
      ctx({
        attemptExists: true,
        attemptStartedAt: at(120),
        attemptExpiresAt: new Date(RECEIVED - 120_000 + 1_200_000),
        sectionStates: state,
      }),
    )

    expect(kinds(result)).toEqual(["apply"])
    expect(result.ok && result.planned[0]?.effectiveAt).toEqual(at(120))
  })
})

describe("validateJournal — start event (structural)", () => {
  it("start_missing: a new attempt must begin with a start event", () => {
    expect(kinds(validateJournal([enter(1, 100, SEC_L)], ctx()))).toEqual(
      INVALID("start_missing"),
    )
  })

  it("start_for_existing_attempt: an existing attempt cannot be started again", () => {
    expect(
      kinds(validateJournal([start(1, 100)], ctx({ attemptExists: true }))),
    ).toEqual(INVALID("start_for_existing_attempt"))
  })

  it("start_repeated: at most one start event", () => {
    expect(
      kinds(validateJournal([start(1, 100), start(2, 90)], ctx())),
    ).toEqual(INVALID("start_repeated"))
  })
})

describe("validateJournal — sections", () => {
  it("unknown_section: refuses entering a section of another version", () => {
    expect(
      kinds(validateJournal([start(1, 100), enter(2, 90, UNKNOWN)], ctx())),
    ).toEqual(INVALID("unknown_section"))
  })

  it("unknown_section: refuses finishing a section of another version", () => {
    expect(
      kinds(validateJournal([start(1, 100), finish(2, 90, UNKNOWN)], ctx())),
    ).toEqual(INVALID("unknown_section"))
  })

  it("section_still_open: refuses entering the next section while the first is still ticking", () => {
    expect(
      kinds(
        validateJournal(
          [start(1, 100), enter(2, 90, SEC_L), enter(3, 80, SEC_R)],
          ctx(),
        ),
      ),
    ).toEqual(INVALID("section_still_open"))
  })

  it("section_still_open: a hydrated open section blocks the next one too", () => {
    const result = validateJournal(
      [enter(1, 30, SEC_R)],
      ctx({
        attemptExists: true,
        attemptStartedAt: at(60),
        attemptExpiresAt: new Date(RECEIVED - 60_000 + 1_200_000),
        sectionStates: new Map([[SEC_L, openState(60, 600)]]),
      }),
    )

    expect(kinds(result)).toEqual(INVALID("section_still_open"))
  })

  it("apply: a repeated enter of the open section is idempotent", () => {
    expect(
      kinds(
        validateJournal(
          [start(1, 100), enter(2, 90, SEC_L), enter(3, 80, SEC_L)],
          ctx(),
        ),
      ),
    ).toEqual(["apply", "apply", "apply"])
  })

  it("apply: the next section may be entered once the previous clock ran out without a finish", () => {
    const events = [start(1, 700), enter(2, 690, SEC_L), enter(3, 80, SEC_R)]

    expect(kinds(validateJournal(events, ctx()))).toEqual([
      "apply",
      "apply",
      "apply",
    ])
  })

  it("section_already_entered: re-entering a finished section is rejected, not applied", () => {
    const events = [
      start(1, 100),
      enter(2, 90, SEC_L),
      finish(3, 80, SEC_L),
      enter(4, 70, SEC_L),
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual([
      "apply",
      "apply",
      "apply",
      "rejected:section_already_entered",
    ])
  })

  it("section_out_of_order: the first section entered must be the first by ordinal", () => {
    expect(
      kinds(validateJournal([start(1, 100), enter(2, 90, SEC_R)], ctx())),
    ).toEqual(INVALID("section_out_of_order"))
  })

  it("section_out_of_order: a section cannot be skipped", () => {
    const events = [
      start(1, 100),
      enter(2, 90, SEC_L),
      finish(3, 80, SEC_L),
      enter(4, 70, SEC_M),
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual(
      INVALID("section_out_of_order"),
    )
  })

  it("section_out_of_order: an earlier section cannot be entered after a later one", () => {
    const later: JournalSectionState = {
      ...openState(200, 600),
      completedAt: at(150),
    }
    const result = validateJournal(
      [enter(1, 100, SEC_L)],
      ctx({
        attemptExists: true,
        attemptStartedAt: at(200),
        attemptExpiresAt: new Date(RECEIVED - 200_000 + 1_200_000),
        sectionStates: new Map([[SEC_R, later]]),
      }),
    )

    expect(kinds(result)).toEqual(INVALID("section_out_of_order"))
  })

  it("section_not_entered: rejects an answer for a section that was never entered", () => {
    expect(
      kinds(validateJournal([start(1, 100), answer(2, 90, SEC_R, QR1)], ctx())),
    ).toEqual(["apply", "rejected:section_not_entered"])
  })

  it("section_not_entered: rejects a position, a play and a finish for a section never entered", () => {
    const events = [
      start(1, 100),
      position(2, 90, SEC_L, QL1),
      play(3, 80),
      finish(4, 70, SEC_L),
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual([
      "apply",
      "rejected:section_not_entered",
      "rejected:section_not_entered",
      "rejected:section_not_entered",
    ])
  })

  it("question_not_in_section: refuses a question that belongs to a different section", () => {
    const events = [
      start(1, 100),
      enter(2, 90, SEC_L),
      answer(3, 80, SEC_L, QR1),
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual(
      INVALID("question_not_in_section"),
    )
  })

  it("question_not_in_section: refuses an unknown question", () => {
    const events = [
      start(1, 100),
      enter(2, 90, SEC_L),
      position(3, 80, SEC_L, UNKNOWN),
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual(
      INVALID("question_not_in_section"),
    )
  })
})

describe("validateJournal — deadlines (late, not applied)", () => {
  it("late: marks events after the section deadline late", () => {
    // Listening entered 3590 s ago has a 600 s clock: an answer 660 s in is late.
    const events = [
      start(1, 3600),
      enter(2, 3590, SEC_L),
      answer(3, 3590 - 660, SEC_L, QL1),
    ]

    expect(
      kinds(validateJournal(events, ctx({ versionDurationSeconds: 7200 }))),
    ).toEqual(["apply", "apply", "late"])
  })

  it("late: the section deadline itself is already late; one millisecond before is not", () => {
    const enteredAt = RECEIVED - 1_000_000
    const deadline = enteredAt + 600_000
    const stamp = (ms: number): string => new Date(ms).toISOString()
    const events: OfflineJournalEvent[] = [
      { ...start(1, 0), clientAt: stamp(enteredAt - 1000) },
      { ...enter(2, 0, SEC_L), clientAt: stamp(enteredAt) },
      { ...answer(3, 0, SEC_L, QL1), clientAt: stamp(deadline - 1) },
      { ...answer(4, 0, SEC_L, QL2), clientAt: stamp(deadline) },
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual([
      "apply",
      "apply",
      "apply",
      "late",
    ])
  })

  it("late: marks events after the whole-attempt deadline late even if the section clock remains", () => {
    // 1200 s attempt; reading entered at 1190 s elapsed has 600 s of section clock but only 10 s of attempt.
    const events = [
      start(1, 2000),
      enter(2, 1990, SEC_L),
      finish(3, 1980, SEC_L),
      enter(4, 1990 - 1190, SEC_R),
      answer(5, 1990 - 1210, SEC_R, QR1),
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual([
      "apply",
      "apply",
      "apply",
      "apply",
      "late",
    ])
  })

  it("late: a hydrated attempt's recorded expires_at is enforced", () => {
    const result = validateJournal(
      [answer(1, 10, SEC_L, QL1)],
      ctx({
        attemptExists: true,
        attemptStartedAt: at(1300),
        attemptExpiresAt: at(100),
        sectionStates: new Map([[SEC_L, openState(1300, 3000)]]),
      }),
    )

    expect(kinds(result)).toEqual(["late"])
  })

  it("late: entering a section after the attempt deadline is late", () => {
    const events = [
      start(1, 2000),
      enter(2, 1990, SEC_L),
      finish(3, 1980, SEC_L),
      enter(4, 700, SEC_R),
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual([
      "apply",
      "apply",
      "apply",
      "late",
    ])
  })

  it("late: finishing a section after its clock ran out is late (the server pins it to the deadline)", () => {
    const events = [start(1, 1000), enter(2, 990, SEC_L), finish(3, 300, SEC_L)]

    expect(kinds(validateJournal(events, ctx()))).toEqual([
      "apply",
      "apply",
      "late",
    ])
  })

  it("late: events after finish_section are late, including a repeated finish", () => {
    const events = [
      start(1, 100),
      enter(2, 90, SEC_L),
      finish(3, 80, SEC_L),
      answer(4, 70, SEC_L, QL1),
      position(5, 65, SEC_L, QL2),
      finish(6, 60, SEC_L),
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual([
      "apply",
      "apply",
      "apply",
      "late",
      "late",
      "late",
    ])
  })

  it("late: every event for a finished (submitted or expired) attempt is late, and its plays are not counted", () => {
    const result = validateJournal(
      [answer(1, 30, SEC_L, QL1), play(2, 20), play(3, 10)],
      ctx({
        attemptExists: true,
        attemptFinished: true,
        attemptStartedAt: at(60),
        attemptExpiresAt: new Date(RECEIVED - 60_000 + 1_200_000),
        sectionStates: new Map([[SEC_L, openState(60, 600)]]),
        playsUsed: new Map([[ST_L, 1]]),
      }),
    )

    expect(kinds(result)).toEqual(["late", "late", "late"])
  })
})

describe("validateJournal — plays", () => {
  it("offline_play_cap_exceeded: fails the whole journal when plays exceed the cap", () => {
    const events = [
      start(1, 100),
      enter(2, 90, SEC_L),
      play(3, 80),
      play(4, 70),
      answer(5, 60, SEC_L, QL1),
    ]

    expect(validateJournal(events, ctx())).toMatchObject({
      ok: false,
      code: "offline_play_cap_exceeded",
      eventSeq: 4,
    })
  })

  it("offline_play_cap_exceeded: counts plays the server already recorded", () => {
    const state = new Map([[SEC_L, openState(90, 600)]])
    const result = validateJournal(
      [play(1, 70)],
      ctx({
        attemptExists: true,
        attemptStartedAt: at(90),
        attemptExpiresAt: new Date(RECEIVED + 1_000_000),
        sectionStates: state,
        playsUsed: new Map([[ST_L, 1]]),
      }),
    )

    expect(result).toMatchObject({
      ok: false,
      code: "offline_play_cap_exceeded",
    })
  })

  it("late: a late play is not counted against the cap", () => {
    const events = [
      start(1, 3600),
      enter(2, 3590, SEC_L),
      play(3, 3500),
      play(4, 3590 - 700),
    ]

    expect(
      kinds(validateJournal(events, ctx({ versionDurationSeconds: 7200 }))),
    ).toEqual(["apply", "apply", "apply", "late"])
  })

  it("apply: an uncapped stimulus may be played any number of times", () => {
    const events = [
      start(1, 300),
      enter(2, 290, SEC_L),
      finish(3, 280, SEC_L),
      enter(4, 270, SEC_R),
      play(5, 260, ST_R),
      play(6, 250, ST_R),
      play(7, 240, ST_R),
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual(
      Array(7).fill("apply"),
    )
  })

  it("unknown_stimulus: refuses a play of something that is not a media stimulus of this version", () => {
    const events = [start(1, 100), enter(2, 90, SEC_L), play(3, 80, UNKNOWN)]

    expect(kinds(validateJournal(events, ctx()))).toEqual(
      INVALID("unknown_stimulus"),
    )
  })
})

describe("validateJournal — navigation", () => {
  it("navigation_locked: rejects moving backwards or answering an earlier question in a forward-only section", () => {
    const events = [
      start(1, 100),
      enter(2, 90, SEC_L),
      position(3, 80, SEC_L, QL2),
      position(4, 70, SEC_L, QL1),
      answer(5, 60, SEC_L, QL1),
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual([
      "apply",
      "apply",
      "apply",
      "rejected:navigation_locked",
      "rejected:navigation_locked",
    ])
  })

  it("navigation_locked: the server's recorded position locks a hydrated forward-only section", () => {
    const result = validateJournal(
      [answer(1, 30, SEC_L, QL1), answer(2, 20, SEC_L, QL2)],
      ctx({
        attemptExists: true,
        attemptStartedAt: at(60),
        attemptExpiresAt: new Date(RECEIVED - 60_000 + 1_200_000),
        sectionStates: new Map([[SEC_L, openState(60, 600)]]),
        currentPosition: { sectionId: SEC_L, questionId: QL2 },
      }),
    )

    expect(kinds(result)).toEqual(["rejected:navigation_locked", "apply"])
  })

  it("apply: answers interleaved with forward moves land (answers are journal events)", () => {
    const events = [
      start(1, 100),
      enter(2, 90, SEC_L),
      answer(3, 80, SEC_L, QL1),
      position(4, 70, SEC_L, QL2),
      answer(5, 60, SEC_L, QL2),
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual(
      Array(5).fill("apply"),
    )
  })

  it("apply: a free section lets the student move backwards", () => {
    const events = [
      start(1, 200),
      enter(2, 190, SEC_L),
      finish(3, 180, SEC_L),
      enter(4, 170, SEC_R),
      position(5, 160, SEC_R, QR2),
      position(6, 150, SEC_R, QR1),
      answer(7, 140, SEC_R, QR1),
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual(
      Array(7).fill("apply"),
    )
  })

  it("apply: appended events for a hydrated (already existing) attempt", () => {
    const state = new Map([[SEC_L, openState(120, 600)]])
    const result = validateJournal(
      [answer(1, 60, SEC_L, QL1)],
      ctx({
        attemptExists: true,
        attemptStartedAt: at(120),
        attemptExpiresAt: new Date(RECEIVED + 1_080_000),
        sectionStates: state,
      }),
    )

    expect(kinds(result)).toEqual(["apply"])
  })
})

describe("buildJournalContext", () => {
  const rows: JournalContextRows = {
    versionDurationSeconds: 1200,
    sections: [
      {
        id: SEC_L,
        ordinal: 1,
        durationSeconds: 600,
        navigation: "forward_only",
        allowAnswerChange: false,
      },
    ],
    stimuli: [{ id: ST_L, sectionId: SEC_L, maxPlays: 1 }],
    questions: [{ id: QL1, sectionId: SEC_L, ordinal: 1 }],
    playsUsed: [{ stimulusId: ST_L, playCount: 1 }],
    sectionStates: [{ sectionId: SEC_L, ...openState(60, 600) }],
    attemptStatus: "expired",
    attemptStartedAt: at(60),
    attemptExpiresAt: at(-1140),
    currentSectionId: SEC_L,
    currentQuestionId: QL1,
  }
  const request = {
    receivedAt: new Date(RECEIVED),
    clientSentAt: new Date(RECEIVED - 5000),
    ackedThrough: 3,
  }

  it("maps repository rows into the validator's lookup context", () => {
    const built = buildJournalContext(rows, request)

    expect(built).toMatchObject({
      ...request,
      attemptExists: true,
      attemptFinished: true,
      currentPosition: { sectionId: SEC_L, questionId: QL1 },
      versionDurationSeconds: 1200,
    })
    expect(built.sections.get(SEC_L)?.navigation).toBe("forward_only")
    expect(built.stimuli.get(ST_L)).toEqual({ sectionId: SEC_L, maxPlays: 1 })
    expect(built.questions.get(QL1)).toEqual({ sectionId: SEC_L, ordinal: 1 })
    expect(built.playsUsed.get(ST_L)).toBe(1)
    expect(built.sectionStates.get(SEC_L)?.completedAt).toBeNull()
  })

  it("treats a missing attempt as new and an in-progress one as not finished", () => {
    const fresh = buildJournalContext(
      { ...rows, attemptStatus: null, currentSectionId: null },
      request,
    )
    const running = buildJournalContext(
      { ...rows, attemptStatus: "in_progress" },
      request,
    )

    expect(fresh).toMatchObject({
      attemptExists: false,
      attemptFinished: false,
      currentPosition: null,
    })
    expect(running).toMatchObject({
      attemptExists: true,
      attemptFinished: false,
    })
  })

  it("matches ids case-insensitively, as Postgres uuids do", () => {
    const upper = (id: string): string => id.toUpperCase()
    const events: OfflineJournalEvent[] = [
      start(1, 100),
      enter(2, 90, upper(SEC_L)),
      play(3, 80, upper(ST_L)),
      answer(4, 70, upper(SEC_L), upper(QL1)),
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual(
      Array(4).fill("apply"),
    )
  })
})
