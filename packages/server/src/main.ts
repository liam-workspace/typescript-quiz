import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import { AllExceptionsFilter } from "@liam-public/node-nest-common"
import { AppModule } from "./app.module.js"
import { loadServerConfig } from "./config.js"

async function bootstrap(): Promise<void> {
  const config = loadServerConfig()
  const app = await NestFactory.create(AppModule)
  app.useGlobalFilters(new AllExceptionsFilter())
  await app.listen(config.port)
}

await bootstrap()
