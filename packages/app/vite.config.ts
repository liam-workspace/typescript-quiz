import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const { version } = createRequire(import.meta.url)("../../package.json") as {
  readonly version: string
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    tanstackRouter({
      target: "react",
      routeToken: "layout",
      routeFileIgnorePattern: "^layout\\.tsx$|\\.test\\.tsx$",
      routesDirectory: "./src/pages",
      generatedRouteTree: "./src/route.gen.ts",
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@pp/app": fileURLToPath(new URL("./src", import.meta.url)),
      "@pp/common": fileURLToPath(new URL("../common/src", import.meta.url)),
    },
  },
  server: {
    // The OIDC redirect URI is registered as `http://localhost:3000/callback`
    // (plan, "The registration") -- a redirect URI matches exactly or not
    // at all, so this is not a preference.
    port: 3000,
    host: "0.0.0.0",
    proxy: {
      // NOT port 3000: this dev server now IS 3000 (it's what the browser
      // and the OIDC redirect_uri both see), so proxying `/api` to that
      // same port would be self-referential. The actual API server
      // (`@pp/server`, `config.ts`'s `PORT`, default 3000 on ITS OWN) must
      // run on 3001 for this specific workflow -- e.g.
      // `PORT=3001 pnpm --filter @pp/server start`, or a docker compose
      // override mapping host 3001 to the container's port 3000. The
      // `compose.yml` "everything on one origin" production-like mode
      // (the api container serving the built SPA itself, no separate vite
      // dev server in the picture at all) is unaffected -- it never hits
      // this proxy.
      "/api": {
        target: "http://localhost:3001",
      },
    },
  },
  preview: {
    port: 4173,
    host: "0.0.0.0",
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
})
