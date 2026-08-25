import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // One PostgreSQL 16 container for the whole `vitest run`, not one per
    // test file. See test/helpers/global-setup.ts.
    globalSetup: ["./test/helpers/global-setup.ts"],
  },
})
