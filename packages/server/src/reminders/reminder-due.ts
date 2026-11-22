/**
 * A reminder is due in the half-open window [target, target + GRACE) of the
 * student's LOCAL day, measured in wall-clock minutes. The grace window lets
 * a restarted server catch up without ever sending a "4:30 pm" reminder at
 * 11 pm. The window is clipped at local midnight on purpose: a reminder
 * scheduled for 23:30 can only be delivered until 23:59.
 *
 * DST falls out of the wall-clock arithmetic: on a spring-forward day a
 * reminder inside the missing hour becomes due at the first minute after the
 * gap (it is already "late"); on a fall-back day the repeated hour would make
 * it due twice, and `lastSentOn` (today's local date, claimed before the
 * send) stops the second.
 */
export const REMINDER_GRACE_MINUTES = 360

export interface LocalMoment {
  /** The zone's calendar date, `YYYY-MM-DD`. */
  readonly date: string
  /** Minutes since local midnight, 0..1439. */
  readonly minutesOfDay: number
}

/**
 * `hourCycle: "h23"` (not `hour12: false`) because some engines render
 * midnight as "24" under the latter. `% 24` is belt and braces.
 * Returns null for a zone this runtime does not know, so one bad row can
 * never throw a whole tick.
 */
export function localMoment(
  instant: Date,
  timezone: string,
): LocalMoment | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant)
    const get = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
      parts.find((part) => part.type === type)?.value
    const year = get("year")
    const month = get("month")
    const day = get("day")
    const hour = get("hour")
    const minute = get("minute")

    if (!year || !month || !day || !hour || !minute) {
      return null
    }

    return {
      date: `${year}-${month}-${day}`,
      minutesOfDay: (Number(hour) % 24) * 60 + Number(minute),
    }
  } catch {
    return null
  }
}

export interface ReminderSchedule {
  readonly timezone: string
  readonly hour: number
  readonly minute: number
  /** Local date of the last reminder sent or claimed, `YYYY-MM-DD`. */
  readonly lastSentOn: string | null
  /** Latest `submitted_at` among the student's finished attempts. */
  readonly lastFinishedAt: Date | null
}

export function isReminderDue(schedule: ReminderSchedule, now: Date): boolean {
  const here = localMoment(now, schedule.timezone)

  if (!here) {
    return false
  }

  const late = here.minutesOfDay - (schedule.hour * 60 + schedule.minute)

  if (late < 0 || late >= REMINDER_GRACE_MINUTES) {
    return false
  }

  if (schedule.lastSentOn === here.date) {
    return false
  }

  if (schedule.lastFinishedAt) {
    const finished = localMoment(schedule.lastFinishedAt, schedule.timezone)

    if (finished?.date === here.date) {
      return false
    }
  }

  return true
}
