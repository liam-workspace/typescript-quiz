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
  },
})
