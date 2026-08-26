import "reflect-metadata"
import { AllExceptionsFilter } from "@liam-public/node-nest-common"
import { waitForDatabase } from "@liam-public/node-postgres"
import { NestFactory } from "@nestjs/core"
import { migrateToLatest } from "@pp/db"
import { AppModule } from "./app.module.js"
import { loadServerConfig } from "./config.js"

async function bootstrap(): Promise<void> {
  const config = loadServerConfig()
  await waitForDatabase(config.databaseUrl, { retries: 30, delayMs: 1000 })
  await migrateToLatest(config.databaseUrl)

  const app = await NestFactory.create(AppModule)
  app.useGlobalFilters(new AllExceptionsFilter())
  await app.listen(config.port)
}

await bootstrap()
