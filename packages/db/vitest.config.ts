import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // One PostgreSQL 16 container for the whole `vitest run`, not one per
    // test file. See test/helpers/global-setup.ts.
    globalSetup: ["./test/helpers/global-setup.ts"],
    // All test files share that one container's `public` schema.
    // `withDatabase` resets and re-migrates it on every call, so two files
    // running at once race on the same DROP SCHEMA / migrations lock.
    // Files must run one at a time; tests within a file already do.
    fileParallelism: false,
  },
})
