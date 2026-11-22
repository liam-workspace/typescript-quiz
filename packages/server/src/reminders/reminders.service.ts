import type { PgPool } from "@liam-workspace/node-postgres"
import { HttpStatus, Inject, Injectable } from "@nestjs/common"
import {
  deleteReminderSubscription,
  findStudentBySubject,
  upsertReminderSubscription,
} from "@pp/db"
import { ProblemException } from "../attempts/problem.exception.js"
import { loadServerConfig } from "../config.js"
import { REQUEST_POOL } from "../database/tokens.js"
import type { ReminderSubscriptionDto } from "./reminder.dto.js"

@Injectable()
export class RemindersService {
  constructor(@Inject(REQUEST_POOL) private readonly pool: PgPool) {}

  async save(
    subjectClaim: string,
    body: ReminderSubscriptionDto,
  ): Promise<void> {
    if (!loadServerConfig().push) {
      throw new ProblemException({
        type: "reminders_not_configured",
        title: "Practice reminders are not configured on this server.",
        status: HttpStatus.SERVICE_UNAVAILABLE,
      })
    }

    const student = await findStudentBySubject(this.pool, subjectClaim)

    if (!student) {
      throw new ProblemException({
        type: "student_not_provisioned",
        title: "No student profile exists for this token.",
        status: HttpStatus.NOT_FOUND,
      })
    }

    await upsertReminderSubscription(this.pool, {
      studentId: student.id,
      endpoint: body.subscription.endpoint,
      p256dh: body.subscription.keys.p256dh,
      auth: body.subscription.keys.auth,
      timezone: body.timezone,
      locale: body.locale,
      hour: body.hour,
      minute: body.minute,
    })
  }

  /** Works with push unconfigured: sign-out cleanup must never fail on config. */
  async remove(subjectClaim: string): Promise<void> {
    const student = await findStudentBySubject(this.pool, subjectClaim)

    if (student) {
      await deleteReminderSubscription(this.pool, student.id)
    }
  }
}
