import { Module } from "@nestjs/common"
import { AttemptsController } from "./attempts.controller.js"
import { AttemptsService } from "./attempts.service.js"
import { OfflineSyncController } from "./offline-sync.controller.js"
import { OfflineSyncService } from "./offline-sync.service.js"

@Module({
  controllers: [AttemptsController, OfflineSyncController],
  providers: [AttemptsService, OfflineSyncService],
})
export class AttemptsModule {}
