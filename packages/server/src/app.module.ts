import { Module } from "@nestjs/common"
import { AdminModule } from "./admin/admin.module.js"
import { AttemptsModule } from "./attempts/attempts.module.js"
import { AuthModule } from "./auth/auth.module.js"
import { CatalogModule } from "./catalog/catalog.module.js"
import { DatabaseModule } from "./database/database.module.js"
import { HealthModule } from "./health/health.module.js"
import { MediaModule } from "./media/media.module.js"
import { ResponsesModule } from "./responses/responses.module.js"
import { SessionModule } from "./session/session.module.js"

@Module({
  imports: [
    AdminModule,
    AttemptsModule,
    AuthModule,
    CatalogModule,
    DatabaseModule,
    HealthModule,
    MediaModule,
    ResponsesModule,
    SessionModule,
  ],
})
export class AppModule {}
