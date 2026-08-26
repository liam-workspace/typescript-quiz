import { Module } from "@nestjs/common"
import { AttemptsModule } from "./attempts/attempts.module.js"
import { AuthModule } from "./auth/auth.module.js"
import { CatalogModule } from "./catalog/catalog.module.js"
import { DatabaseModule } from "./database/database.module.js"
import { HealthModule } from "./health/health.module.js"
import { SessionModule } from "./session/session.module.js"

@Module({
  imports: [
    AttemptsModule,
    AuthModule,
    CatalogModule,
    DatabaseModule,
    HealthModule,
    SessionModule,
  ],
})
export class AppModule {}
