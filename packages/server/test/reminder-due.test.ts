import { describe, expect, it } from "vitest"
import {
  REMINDER_GRACE_MINUTES,
  isReminderDue,
  localMoment,
  type ReminderSchedule,
} from "../src/reminders/reminder-due.js"

const NY: ReminderSchedule = {
  timezone: "America/New_York",
  hour: 16,
  minute: 30,
  lastSentOn: null,
  lastFinishedAt: null,
}
const at = (iso: string): Date => new Date(iso)
const MINUTE = 60_000

describe("localMoment", () => {
  it("returns the zone's calendar date and minutes since local midnight", () => {
    // 21:30Z is 16:30 EST (UTC-5) in January.
    expect(localMoment(at("2026-01-15T21:30:00Z"), "America/New_York")).toEqual(
      { date: "2026-01-15", minutesOfDay: 990 },
    )
  })

  it("rolls the local date forward ahead of UTC (UTC+14)", () => {
    // 10:30Z on the 15th is 00:30 on the 16th in Pacific/Kiritimati.
    expect(
      localMoment(at("2026-01-15T10:30:00Z"), "Pacific/Kiritimati"),
    ).toEqual({ date: "2026-01-16", minutesOfDay: 30 })
  })

  it("reports local midnight as minute 0, never 1440", () => {
    // 05:00Z is 00:00 EST.
    expect(
      localMoment(at("2026-01-15T05:00:00Z"), "America/New_York")?.minutesOfDay,
    ).toBe(0)
  })

  it("handles a 45-minute offset (Asia/Kathmandu, UTC+5:45)", () => {
    // 10:45Z is 16:30 NPT.
    expect(localMoment(at("2026-01-15T10:45:00Z"), "Asia/Kathmandu")).toEqual({
      date: "2026-01-15",
      minutesOfDay: 990,
    })
  })

  it("returns null for an unknown zone instead of throwing", () => {
    expect(localMoment(at("2026-01-15T21:30:00Z"), "Mars/Phobos")).toBeNull()
  })
})

describe("isReminderDue", () => {
  it("is not due one minute before the local time", () => {
    // 16:29 EST
    expect(isReminderDue(NY, at("2026-01-15T21:29:00Z"))).toBe(false)
  })

  it("is due at exactly the local time", () => {
    // 16:30 EST
    expect(isReminderDue(NY, at("2026-01-15T21:30:00Z"))).toBe(true)
  })

  it("follows daylight saving: the same 16:30 is 20:30Z in July", () => {
    // 16:29 EDT
    expect(isReminderDue(NY, at("2026-07-15T20:29:00Z"))).toBe(false)
    // 16:30 EDT
    expect(isReminderDue(NY, at("2026-07-15T20:30:00Z"))).toBe(true)
  })

  it("catches up after downtime but only inside the grace window", () => {
    expect(REMINDER_GRACE_MINUTES).toBe(360)
    // 22:29 EST, 359 min late
    expect(isReminderDue(NY, at("2026-01-16T03:29:00Z"))).toBe(true)
    // 22:30 EST, 360 min late
    expect(isReminderDue(NY, at("2026-01-16T03:30:00Z"))).toBe(false)
  })

  it("clips the grace window at local midnight", () => {
    const late: ReminderSchedule = { ...NY, hour: 23, minute: 30 }

    // 23:59 EST
    expect(isReminderDue(late, at("2026-01-16T04:59:00Z"))).toBe(true)
    // 00:00 EST next day
    expect(isReminderDue(late, at("2026-01-16T05:00:00Z"))).toBe(false)
    // 01:00 EST next day
    expect(isReminderDue(late, at("2026-01-16T06:00:00Z"))).toBe(false)
  })

  it("is not due again once today's local date was already sent", () => {
    expect(
      isReminderDue(
        { ...NY, lastSentOn: "2026-01-15" },
        at("2026-01-15T21:30:00Z"),
      ),
    ).toBe(false)
  })

  it("is due again the next local day after yesterday's send", () => {
    expect(
      isReminderDue(
        { ...NY, lastSentOn: "2026-01-15" },
        at("2026-01-16T21:30:00Z"),
      ),
    ).toBe(true)
  })

  it("is skipped when the student finished an attempt earlier the same local day", () => {
    expect(
      isReminderDue(
        // 10:00 EST today
        { ...NY, lastFinishedAt: at("2026-01-15T15:00:00Z") },
        at("2026-01-15T21:30:00Z"),
      ),
    ).toBe(false)
  })

  it("is NOT skipped for an attempt finished the previous local day, even if that is today in UTC", () => {
    expect(
      isReminderDue(
        // 23:00 EST on the 14th
        { ...NY, lastFinishedAt: at("2026-01-15T04:00:00Z") },
        at("2026-01-15T21:30:00Z"),
      ),
    ).toBe(true)
  })

  it("spring forward: a 02:30 reminder that does not exist fires at the first tick after 03:00", () => {
    const springForward: ReminderSchedule = { ...NY, hour: 2, minute: 30 }

    // 01:59 EST
    expect(isReminderDue(springForward, at("2026-03-08T06:59:00Z"))).toBe(false)
    // 03:00 EDT (02:xx skipped)
    expect(isReminderDue(springForward, at("2026-03-08T07:00:00Z"))).toBe(true)
  })

  it("fall back: 01:30 happens twice but lastSentOn stops the second", () => {
    const fallBack: ReminderSchedule = { ...NY, hour: 1, minute: 30 }

    // 01:30 EDT, first pass
    expect(isReminderDue(fallBack, at("2026-11-01T05:30:00Z"))).toBe(true)
    expect(
      isReminderDue(
        { ...fallBack, lastSentOn: "2026-11-01" },
        at("2026-11-01T06:30:00Z"),
      ),
      // 01:30 EST, second pass
    ).toBe(false)
  })

  it("handles a half-hour offset (Asia/Kolkata, UTC+5:30)", () => {
    const kolkata: ReminderSchedule = { ...NY, timezone: "Asia/Kolkata" }

    // 16:29 IST
    expect(isReminderDue(kolkata, at("2026-01-15T10:59:00Z"))).toBe(false)
    // 16:30 IST
    expect(isReminderDue(kolkata, at("2026-01-15T11:00:00Z"))).toBe(true)
  })

  it("handles a 45-minute offset (Asia/Kathmandu, UTC+5:45)", () => {
    const kathmandu: ReminderSchedule = { ...NY, timezone: "Asia/Kathmandu" }

    // 16:29 NPT
    expect(isReminderDue(kathmandu, at("2026-01-15T10:44:00Z"))).toBe(false)
    // 16:30 NPT
    expect(isReminderDue(kathmandu, at("2026-01-15T10:45:00Z"))).toBe(true)
  })

  it("compares the sent date in the student's zone, not UTC (UTC+14)", () => {
    const kiritimati: ReminderSchedule = {
      ...NY,
      timezone: "Pacific/Kiritimati",
      hour: 0,
      minute: 15,
    }
    // 00:30 on 2026-01-16 local
    const now = at("2026-01-15T10:30:00Z")

    expect(
      isReminderDue({ ...kiritimati, lastSentOn: "2026-01-15" }, now),
    ).toBe(true)
    expect(
      isReminderDue({ ...kiritimati, lastSentOn: "2026-01-16" }, now),
    ).toBe(false)
  })

  it("is never due for an unknown timezone", () => {
    expect(
      isReminderDue(
        { ...NY, timezone: "Mars/Phobos" },
        at("2026-01-15T21:30:00Z"),
      ),
    ).toBe(false)
  })
})

/**
 * Drives `isReminderDue` minute by minute across a whole window the way the
 * scheduler does (a send records `lastSentOn` = today's local date) and
 * returns every UTC instant a reminder would have been sent.
 */
function simulate(
  schedule: ReminderSchedule,
  fromIso: string,
  toIso: string,
): Date[] {
  const sends: Date[] = []
  let current = schedule

  for (
    let instant = at(fromIso).getTime();
    instant < at(toIso).getTime();
    instant += MINUTE
  ) {
    const now = new Date(instant)

    if (isReminderDue(current, now)) {
      sends.push(now)
      current = {
        ...current,
        lastSentOn: localMoment(now, current.timezone)?.date ?? null,
      }
    }
  }

  return sends
}

interface DstCase {
  readonly name: string
  readonly timezone: string
  readonly hour: number
  readonly minute: number
  /** UTC window covering the transition day plus the days either side. */
  readonly from: string
  readonly to: string
  /** The expected send instants, in UTC, one per local day. */
  readonly sends: readonly string[]
}

const DST_CASES: readonly DstCase[] = [
  {
    // Berlin springs forward 2026-03-29 at 02:00 CET (01:00Z) -> 03:00 CEST.
    name: "Europe/Berlin spring forward, 02:30 does not exist",
    timezone: "Europe/Berlin",
    hour: 2,
    minute: 30,
    from: "2026-03-27T23:00:00Z",
    to: "2026-03-30T22:00:00Z",
    sends: [
      // 02:30 CET
      "2026-03-28T01:30:00.000Z",
      // 03:00 CEST, first minute after the gap
      "2026-03-29T01:00:00.000Z",
      // 02:30 CEST
      "2026-03-30T00:30:00.000Z",
    ],
  },
  {
    // Berlin falls back 2026-10-25 at 03:00 CEST (01:00Z) -> 02:00 CET.
    name: "Europe/Berlin fall back, 02:30 happens twice",
    timezone: "Europe/Berlin",
    hour: 2,
    minute: 30,
    from: "2026-10-23T22:00:00Z",
    to: "2026-10-26T23:00:00Z",
    sends: [
      // 02:30 CEST
      "2026-10-24T00:30:00.000Z",
      // First 02:30 (CEST); the CET one is skipped
      "2026-10-25T00:30:00.000Z",
      // 02:30 CET
      "2026-10-26T01:30:00.000Z",
    ],
  },
  {
    name: "Europe/Berlin fall back, an afternoon reminder keeps its wall time",
    timezone: "Europe/Berlin",
    hour: 16,
    minute: 30,
    from: "2026-10-23T22:00:00Z",
    to: "2026-10-26T23:00:00Z",
    sends: [
      // 16:30 CEST
      "2026-10-24T14:30:00.000Z",
      // 16:30 CET
      "2026-10-25T15:30:00.000Z",
      // 16:30 CET
      "2026-10-26T15:30:00.000Z",
    ],
  },
  {
    // New York springs forward 2026-03-08 at 02:00 EST (07:00Z) -> 03:00 EDT.
    name: "America/New_York spring forward, 02:30 does not exist",
    timezone: "America/New_York",
    hour: 2,
    minute: 30,
    from: "2026-03-07T05:00:00Z",
    to: "2026-03-10T04:00:00Z",
    sends: [
      // 02:30 EST
      "2026-03-07T07:30:00.000Z",
      // 03:00 EDT
      "2026-03-08T07:00:00.000Z",
      // 02:30 EDT
      "2026-03-09T06:30:00.000Z",
    ],
  },
  {
    // New York falls back 2026-11-01 at 02:00 EDT (06:00Z) -> 01:00 EST.
    name: "America/New_York fall back, 01:30 happens twice",
    timezone: "America/New_York",
    hour: 1,
    minute: 30,
    from: "2026-10-31T04:00:00Z",
    to: "2026-11-03T05:00:00Z",
    sends: [
      // 01:30 EDT
      "2026-10-31T05:30:00.000Z",
      // First 01:30 (EDT); the EST one is skipped
      "2026-11-01T05:30:00.000Z",
      // 01:30 EST
      "2026-11-02T06:30:00.000Z",
    ],
  },
  {
    name: "America/New_York spring-forward day, 16:30",
    timezone: "America/New_York",
    hour: 16,
    minute: 30,
    from: "2026-03-07T05:00:00Z",
    to: "2026-03-10T04:00:00Z",
    sends: [
      // 16:30 EST
      "2026-03-07T21:30:00.000Z",
      // 16:30 EDT
      "2026-03-08T20:30:00.000Z",
      // 16:30 EDT
      "2026-03-09T20:30:00.000Z",
    ],
  },
  {
    // No DST; the reminder lands on a :45 UTC minute.
    name: "Asia/Kathmandu (UTC+5:45) over the New York transition",
    timezone: "Asia/Kathmandu",
    hour: 16,
    minute: 30,
    from: "2026-10-31T18:15:00Z",
    to: "2026-11-03T18:15:00Z",
    sends: [
      "2026-11-01T10:45:00.000Z",
      "2026-11-02T10:45:00.000Z",
      "2026-11-03T10:45:00.000Z",
    ],
  },
  {
    name: "Asia/Kolkata (UTC+5:30) over the Berlin transition",
    timezone: "Asia/Kolkata",
    hour: 0,
    minute: 0,
    from: "2026-03-28T18:30:00Z",
    to: "2026-03-31T18:30:00Z",
    sends: [
      "2026-03-28T18:30:00.000Z",
      "2026-03-29T18:30:00.000Z",
      "2026-03-30T18:30:00.000Z",
    ],
  },
]

describe("isReminderDue across DST, simulated minute by minute", () => {
  it.each(DST_CASES)("$name: exactly one send per local day", (testCase) => {
    const sends = simulate(
      {
        timezone: testCase.timezone,
        hour: testCase.hour,
        minute: testCase.minute,
        lastSentOn: null,
        lastFinishedAt: null,
      },
      testCase.from,
      testCase.to,
    )

    expect(sends.map((send) => send.toISOString())).toEqual(testCase.sends)

    const days = sends.map((send) => localMoment(send, testCase.timezone)?.date)

    expect(new Set(days).size).toBe(days.length)
  })

  it("a reminder the scheduler cannot deliver (lastSentOn never advances) is still bounded to the grace window of its own day", () => {
    // Fall-back day, 01:30 New York, every delivery fails: due minutes are
    // 01:30-01:59 EDT, then (the wall clock repeats 01:00-01:59) 01:30-07:29
    // EST, never into the next local day.
    let due = 0

    for (
      let instant = at("2026-11-01T04:00:00Z").getTime();
      instant < at("2026-11-02T04:00:00Z").getTime();
      instant += MINUTE
    ) {
      if (isReminderDue({ ...NY, hour: 1, minute: 30 }, new Date(instant))) {
        due += 1
      }
    }

    expect(due).toBe(30 + REMINDER_GRACE_MINUTES)
  })
})
