import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@pp/common": new URL("../common/src/index.ts", import.meta.url).pathname,
      "@pp/db": new URL("../db/src/index.ts", import.meta.url).pathname,
    },
  },
})
