import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@pp/db/scoring": new URL("../db/src/scoring.ts", import.meta.url)
        .pathname,
      "@pp/db/admin": new URL("../db/src/admin.ts", import.meta.url).pathname,
      "@pp/common/scoring": new URL("../common/src/scoring.ts", import.meta.url)
        .pathname,
      "@pp/common": new URL("../common/src/index.ts", import.meta.url).pathname,
      "@pp/db": new URL("../db/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    globalSetup: ["./test/helpers/global-setup.ts"],
    // Files share the container's `public` schema and each resets it, so two
    // at once race on DROP SCHEMA and the migrations lock.
    fileParallelism: false,
    // Every test in this package boots a Nest app and talks to a real
    // Postgres container. Vitest's 5s default is not a budget those fit
    // inside reliably: three separate runs this session failed at exactly
    // 5001-5003ms and then passed on re-run, in three different files.
    // A suite that fails intermittently for no reason is worse than a slow
    // one -- it teaches you to re-run rather than read the failure, which
    // is precisely how a real regression gets waved through. The db package
    // already gives its container tests 120s, per test; this is the same
    // budget applied once, at the package level.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
