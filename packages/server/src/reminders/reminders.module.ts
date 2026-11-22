import { Module } from "@nestjs/common"
import { loadServerConfig } from "../config.js"
import { WebPushSender, type PushSender } from "./push-sender.js"
import {
  ReminderScheduler,
  type ReminderSchedulerConfig,
} from "./reminder.scheduler.js"
import { RemindersController } from "./reminders.controller.js"
import { RemindersService } from "./reminders.service.js"
import { PUSH_SENDER, REMINDER_SCHEDULER_CONFIG } from "./tokens.js"

@Module({
  controllers: [RemindersController],
  providers: [
    RemindersService,
    {
      provide: PUSH_SENDER,
      useFactory: (): PushSender | null => {
        const { push } = loadServerConfig()

        return push ? new WebPushSender(push) : null
      },
    },
    {
      provide: REMINDER_SCHEDULER_CONFIG,
      useFactory: (): ReminderSchedulerConfig => {
        const config = loadServerConfig()

        return {
          enabled: config.reminderSchedulerEnabled,
          pushEndpointHosts: config.pushEndpointHosts,
        }
      },
    },
    ReminderScheduler,
  ],
})
export class RemindersModule {}
