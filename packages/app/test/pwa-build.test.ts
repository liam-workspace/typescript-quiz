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
        env: {
          ...process.env,
          NODE_ENV: "production",
          VITEST: undefined,
          // What the Dockerfile bakes; docker-entrypoint.sh replaces it.
          VITE_VAPID_PUBLIC_KEY: "__VITE_VAPID_PUBLIC_KEY__",
        },
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

  it("the built worker imports the push handlers, which ship next to it", () => {
    expect(sw).toMatch(/importScripts\(\s*"push-sw\.js"\s*\)/u)
    expect(readFileSync(join(outDir, "push-sw.js"), "utf8")).toContain(
      '"practice-reminder"',
    )
  })

  it("keeps the VAPID placeholder literal in the bundle for docker-entrypoint.sh to replace", () => {
    // A minifier that folded the client's placeholder check would drop the
    // literal, and every container would ship reminders as "unsupported".
    const bundle = readdirSync(join(outDir, "assets"))
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFileSync(join(outDir, "assets", name), "utf8"))
      .join("\n")

    expect(bundle).toContain("__VITE_VAPID_PUBLIC_KEY__")
  })

  it("has every manifest field Chrome needs to call the app installable", () => {
    const manifest = JSON.parse(
      readFileSync(join(outDir, "manifest.webmanifest"), "utf8"),
    ) as {
      name: string
      short_name: string
      start_url: string
      scope: string
      display: string
      theme_color: string
      background_color: string
      icons: Array<{ src: string; sizes: string; purpose?: string }>
    }

    expect(manifest).toMatchObject({
      start_url: "/",
      scope: "/",
      display: "standalone",
    })
    expect(manifest.name.length).toBeGreaterThan(0)
    expect(manifest.short_name.length).toBeGreaterThan(0)
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/iu)
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/iu)
    expect(manifest.icons.some((icon) => icon.sizes === "192x192")).toBe(true)
    expect(manifest.icons.some((icon) => icon.sizes === "512x512")).toBe(true)
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(
      true,
    )

    // Every declared icon is a real PNG on disk, not a 404 or an HTML fallback.
    const pngSignature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])

    for (const icon of manifest.icons) {
      const file = join(outDir, icon.src.replace(/^\//u, ""))

      expect(existsSync(file), `${icon.src} is missing`).toBe(true)
      expect(readFileSync(file).subarray(0, 8).equals(pngSignature)).toBe(true)
    }
  })

  it("has the apple-touch-icon and theme colour, and no Google Fonts links", () => {
    const html = readFileSync(join(outDir, "index.html"), "utf8")

    expect(html).toContain('rel="apple-touch-icon"')
    expect(html).toContain('name="theme-color"')
    expect(html).not.toContain("fonts.googleapis.com")
    expect(html).not.toContain("fonts.gstatic.com")
  })

  it("precaches the shell and self-hosted fonts, and never an API, media or health route", () => {
    const urls = [...sw.matchAll(/url:\s*"([^"]+)"/gu)].map((match) => match[1])

    expect(urls).toContain("index.html")
    expect(urls).toContain("push-sw.js")
    expect(urls.some((url) => url.endsWith(".woff2"))).toBe(true)
    expect(urls.some((url) => url.endsWith(".css"))).toBe(true)

    for (const url of urls) {
      expect(url).not.toMatch(/^\/?(api|media|health)(\/|$)/u)
    }
  })

  it("falls back to the app shell for navigations except /api, /media and /health", () => {
    expect(sw).toContain("createHandlerBoundToURL")
    expect(sw).toMatch(/denylist:\[[^\]]*api[^\]]*media[^\]]*health[^\]]*\]/u)
  })

  it("only skips waiting when the page asks (registerType: prompt)", () => {
    // The sole skipWaiting() call sits inside the SKIP_WAITING message handler.
    expect(sw.match(/skipWaiting\(\)/gu)).toHaveLength(1)
    expect(sw).toMatch(
      /"message",\w+=>\{[^}]*"SKIP_WAITING"===[^}]*skipWaiting\(\)\}\)/u,
    )
  })

  it("never routes a mutating or per-student attempt call through the runtime cache", () => {
    expect(sw).not.toContain("/api/session")
    expect(sw).not.toMatch(
      /\/api\/attempts\/[^"']*(submit|position|responses|play|sections)/u,
    )
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
