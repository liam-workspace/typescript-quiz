import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
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
