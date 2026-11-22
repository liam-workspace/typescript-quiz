import { withTransaction, type PgPool } from "@liam-workspace/node-postgres"
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common"
import type { Clock } from "@pp/common"
import {
  claimReminderSend,
  deleteReminderSubscriptionByEndpoint,
  listReminderCandidates,
  releaseReminderClaim,
  type ReminderCandidateRow,
  type ReminderClaim,
} from "@pp/db"
import { CLOCK, JOB_POOL } from "../database/tokens.js"
import { canonicalPushEndpoint } from "./push-endpoint.js"
import type { PushOutcome, PushSender } from "./push-sender.js"
import { isReminderDue, localMoment } from "./reminder-due.js"
import { reminderMessage } from "./reminder-messages.js"
import { PUSH_SENDER, REMINDER_SCHEDULER_CONFIG } from "./tokens.js"

/** Arbitrary, fixed, and within int8: the cross-instance "one scheduler" key. */
export const REMINDER_LOCK_KEY = 7_302_261_130

export const REMINDER_RETRY_MINUTES = 15

export const REMINDER_TICK_MS = 60_000

export interface ReminderSchedulerConfig {
  /**
   * Whether `onModuleInit` starts the 60 s timer. `tick()` works either way
   * (tests drive it directly). Off under NODE_ENV=test unless
   * REMINDER_SCHEDULER_ENABLED=true.
   */
  readonly enabled: boolean
  /**
   * The VALIDATED `loadServerConfig().pushEndpointHosts`. Never raw strings:
   * `canonicalPushEndpoint` trusts the suffixes it is given.
   */
  readonly pushEndpointHosts: readonly string[]
}

export interface TickSummary {
  /**
   * `locked`: another instance (or this one's previous tick) is running.
   * `error`: the tick failed before delivering (database down); logged, and
   * the next tick tries again.
   */
  readonly status: "ran" | "locked" | "disabled" | "error"
  readonly sent: number
  readonly removed: number
  /** Transient failures: claim released, retried after the back-off. */
  readonly failed: number
  /** 400/401/403/413: claim kept (no retry today), row kept. */
  readonly rejected: number
  /** Due now, but held back: finished an attempt today, or backing off. */
  readonly skipped: number
  /** Rows whose timezone this runtime does not know: never due. */
  readonly invalid: number
}

const EMPTY = {
  sent: 0,
  removed: 0,
  failed: 0,
  rejected: 0,
  skipped: 0,
  invalid: 0,
} as const

interface Claimed {
  readonly candidate: ReminderCandidateRow
  readonly claim: ReminderClaim
}

interface ClaimRound {
  readonly claimed: readonly Claimed[]
  readonly removed: number
  readonly skipped: number
  readonly invalid: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Claim, then send. A short transaction on the job pool takes
 * `pg_try_advisory_xact_lock` (a second replica simply skips the tick), finds
 * the due students, re-checks each stored endpoint against the push-service
 * allow-list, and CLAIMS today's local date for each -- then commits BEFORE
 * any network call, so no transaction is held open across a push-service
 * round trip, and a crash between claim and send loses one reminder rather
 * than sending two. A transient failure releases its claim and is retried
 * after REMINDER_RETRY_MINUTES (in memory, per process) until the grace
 * window ends; the claim, not the throttle, is what prevents a double send.
 *
 * Logs carry the student id at most: never the endpoint (a capability URL),
 * the subscription keys, or the VAPID key.
 */
@Injectable()
export class ReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderScheduler.name)
  /** Student id -> epoch ms before which no retry is attempted. */
  private readonly retryAfter = new Map<string, number>()
  private timer: ReturnType<typeof setInterval> | null = null
  private running: Promise<TickSummary> | null = null
  /** Students already logged for an unknown timezone, so it is logged once. */
  private readonly reportedInvalidZones = new Set<string>()

  constructor(
    @Inject(JOB_POOL) private readonly pool: PgPool,
    @Inject(PUSH_SENDER) private readonly sender: PushSender | null,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(REMINDER_SCHEDULER_CONFIG)
    private readonly config: ReminderSchedulerConfig,
  ) {}

  onModuleInit(): void {
    if (!this.sender || !this.config.enabled) {
      return
    }

    this.timer = setInterval(() => {
      void this.tick()
    }, REMINDER_TICK_MS)
    this.timer.unref()
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    await this.running
  }

  tick(): Promise<TickSummary> {
    const { sender } = this

    if (!sender) {
      return Promise.resolve({ status: "disabled", ...EMPTY })
    }

    if (this.running) {
      return Promise.resolve({ status: "locked", ...EMPTY })
    }

    const running = this.run(sender).finally(() => {
      this.running = null
    })

    this.running = running

    return running
  }

  private async run(sender: PushSender): Promise<TickSummary> {
    try {
      const now = this.clock.now()

      this.forgetExpiredBackoffs(now)

      const round = await this.claimDue(now)

      if (round === null) {
        return { status: "locked", ...EMPTY }
      }

      return await this.deliver(sender, round, now)
    } catch (error) {
      this.logger.error(`reminder tick failed: ${errorMessage(error)}`)

      return { status: "error", ...EMPTY }
    }
  }

  private forgetExpiredBackoffs(now: Date): void {
    for (const [studentId, retryAt] of this.retryAfter) {
      if (retryAt <= now.getTime()) {
        this.retryAfter.delete(studentId)
      }
    }
  }

  private claimDue(now: Date): Promise<ClaimRound | null> {
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_xact_lock($1::bigint) AS locked`,
        [REMINDER_LOCK_KEY],
      )

      if (!rows[0]?.locked) {
        return null
      }

      const claimed: Claimed[] = []
      let removed = 0
      let skipped = 0
      let invalid = 0

      for (const candidate of await listReminderCandidates(tx)) {
        const here = localMoment(now, candidate.timezone)

        if (!here) {
          invalid += 1
          this.reportInvalidZone(candidate.studentId)

          continue
        }

        if (!isReminderDue({ ...candidate, lastFinishedAt: null }, now)) {
          continue
        }

        if (
          this.retryAfter.has(candidate.studentId) ||
          !isReminderDue(candidate, now)
        ) {
          skipped += 1

          continue
        }

        // The SSRF boundary, again at send time: config can change, and a
        // stored row outlives the config that admitted it. Stored endpoints
        // are canonical, so anything but an exact match is refused.
        if (
          canonicalPushEndpoint(
            candidate.endpoint,
            this.config.pushEndpointHosts,
          ) !== candidate.endpoint
        ) {
          // oxlint-disable-next-line no-await-in-loop -- one transaction, one row at a time
          await deleteReminderSubscriptionByEndpoint(tx, candidate.endpoint)
          removed += 1
          this.logger.warn(
            `reminder subscription of student ${candidate.studentId} removed: endpoint no longer allowed`,
          )

          continue
        }

        const claim: ReminderClaim = {
          studentId: candidate.studentId,
          endpoint: candidate.endpoint,
          localDate: here.date,
        }

        // oxlint-disable-next-line no-await-in-loop -- one transaction, one row at a time
        if (await claimReminderSend(tx, claim)) {
          claimed.push({ candidate, claim })
        }
      }

      return { claimed, removed, skipped, invalid }
    })
  }

  private reportInvalidZone(studentId: string): void {
    if (this.reportedInvalidZones.has(studentId)) {
      return
    }

    this.reportedInvalidZones.add(studentId)
    this.logger.warn(
      `reminder subscription of student ${studentId} has a timezone this runtime does not know; it is never due`,
    )
  }

  private async deliver(
    sender: PushSender,
    round: ClaimRound,
    now: Date,
  ): Promise<TickSummary> {
    let sent = 0
    let { removed } = round
    let failed = 0
    let rejected = 0

    // Sequential on purpose: the job pool is small and shared, and a
    // family-sized deployment has a handful of reminders per minute.
    for (const item of round.claimed) {
      // oxlint-disable-next-line no-await-in-loop -- one push at a time
      const outcome = await this.sendOne(sender, item)

      if (outcome === "sent") {
        sent += 1
      } else if (outcome === "removed") {
        removed += 1
      } else if (outcome === "rejected") {
        rejected += 1
      } else {
        failed += 1
        this.retryAfter.set(
          item.claim.studentId,
          now.getTime() + REMINDER_RETRY_MINUTES * 60_000,
        )
      }
    }

    return {
      status: "ran",
      sent,
      removed,
      failed,
      rejected,
      skipped: round.skipped,
      invalid: round.invalid,
    }
  }

  private async sendOne(
    sender: PushSender,
    { candidate, claim }: Claimed,
  ): Promise<"sent" | "removed" | "rejected" | "failed"> {
    let outcome: PushOutcome = { kind: "failed", statusCode: null }

    try {
      outcome = await sender.send(
        {
          endpoint: candidate.endpoint,
          p256dh: candidate.p256dh,
          auth: candidate.auth,
        },
        reminderMessage(candidate.locale),
      )
    } catch {
      // A sender is not supposed to throw; if one does, the error may carry
      // the endpoint, so it is not logged. Treated as transient.
    }

    try {
      if (outcome.kind === "sent") {
        this.retryAfter.delete(claim.studentId)

        return "sent"
      }

      if (outcome.kind === "gone") {
        this.retryAfter.delete(claim.studentId)
        await deleteReminderSubscriptionByEndpoint(
          this.pool,
          candidate.endpoint,
        )

        return "removed"
      }

      if (outcome.kind === "rejected") {
        // The claim stays (no retry today) and so does the row: a 403 from
        // a server-wide VAPID mistake must not wipe every subscription.
        this.retryAfter.delete(claim.studentId)
        this.logger.warn(
          `reminder push for student ${claim.studentId} rejected (status ${String(outcome.statusCode)}); not retried today`,
        )

        return "rejected"
      }

      await releaseReminderClaim(this.pool, claim, candidate.lastSentOn)
      this.logger.warn(
        `reminder push for student ${claim.studentId} failed (status ${String(outcome.statusCode)}); retry in ${String(REMINDER_RETRY_MINUTES)} min`,
      )
    } catch (error) {
      // The claim stays: today's reminder is lost, never sent twice.
      this.logger.error(
        `reminder bookkeeping for student ${claim.studentId} failed: ${errorMessage(error)}`,
      )
    }

    return "failed"
  }
}
