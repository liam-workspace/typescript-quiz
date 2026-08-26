import { Module } from "@nestjs/common"
import { AuthModule } from "./auth/auth.module.js"
import { DatabaseModule } from "./database/database.module.js"
import { HealthModule } from "./health/health.module.js"
import { SessionModule } from "./session/session.module.js"

@Module({ imports: [AuthModule, DatabaseModule, HealthModule, SessionModule] })
export class AppModule {}
