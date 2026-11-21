import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

describe("production build: installable shell and worker policy", () => {
  const appRoot = process.cwd()
  let outDir = ""
  let sw = ""

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), "pp-app-pwa-build-"))

    execFileSync(
      "pnpm",
      ["exec", "vite", "build", "--mode", "production", "--outDir", outDir],
      {
        cwd: appRoot,
        env: { ...process.env, NODE_ENV: "production", VITEST: undefined },
        stdio: "pipe",
      },
    )

    sw = readFileSync(join(outDir, "sw.js"), "utf8")
  }, 120_000)

  afterAll(() => {
    if (outDir) {
      rmSync(outDir, { recursive: true, force: true })
    }
  })

  it("emits the manifest, worker, icons and self-hosted fonts", () => {
    for (const file of [
      "manifest.webmanifest",
      "sw.js",
      "pwa-192x192.png",
      "pwa-512x512.png",
      "pwa-maskable-512x512.png",
      "apple-touch-icon-180x180.png",
      "icon.svg",
    ]) {
      expect(existsSync(join(outDir, file)), file).toBe(true)
    }

    const fonts = readdirSync(join(outDir, "assets")).filter((name) =>
      name.endsWith(".woff2"),
    )

    expect(fonts.length).toBeGreaterThan(0)
  })

  it("links the manifest from index.html exactly once", () => {
    const html = readFileSync(join(outDir, "index.html"), "utf8")

    expect(html.match(/rel="manifest"/gu)).toHaveLength(1)
  })

  it("runtime-caches only the API cache and never the media or offline caches", () => {
    expect(sw).toContain("pp-api-v1")
    expect(sw).not.toContain("pp-offline-media")
    expect(sw).not.toMatch(/api\/media/u)
  })

  it("serialised the allow-list function intact (no __name helper, anchored regexes)", () => {
    expect(sw).not.toContain("__name")
    expect(sw).toMatch(/\\\/api\\\/\(tests\|me\|attempts\)/u)
  })

  it("keeps /api out of the navigation fallback and never calls skipWaiting by itself", () => {
    expect(sw).toMatch(/denylist:\[[^\]]*api/u)
    expect(sw).not.toMatch(
      /skipWaiting\(\)\s*;?\s*self\.addEventListener\("install"/u,
    )
  })
})
