import { Global, Module } from "@nestjs/common"
import { systemClock } from "@pp/common"
import { createJobPool, createRequestPool, loadDbConfig } from "@pp/db"
import { CLOCK, JOB_POOL, REQUEST_POOL } from "./tokens.js"

/**
 * Global: every feature module needs a pool, and re-importing this in each
 * one would create a second set of pools per import.
 */
@Global()
@Module({
  providers: [
    {
      provide: REQUEST_POOL,
      useFactory: () => createRequestPool(loadDbConfig()),
    },
    { provide: JOB_POOL, useFactory: () => createJobPool(loadDbConfig()) },
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [REQUEST_POOL, JOB_POOL, CLOCK],
})
export class DatabaseModule {}
