import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { isCacheableApiRequest, pwaOptions } from "../pwa.config.js"

const appRoot = process.cwd()

function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(join(appRoot, "public", file))

  // PNG IHDR: width at byte 16, height at byte 20 (big-endian).
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe("pwaOptions manifest", () => {
  const manifest = pwaOptions.manifest as Record<string, unknown>

  it("describes a standalone, installable app that starts at /", () => {
    expect(manifest).toMatchObject({
      name: "Primary Practice",
      short_name: "Primary Practice",
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      theme_color: "#ffffff",
      background_color: "#0f6e78",
    })
  })

  it("declares 192, 512 and a separate maskable 512 icon, and every file exists at that size", () => {
    const icons = manifest.icons as Array<{
      src: string
      sizes: string
      purpose?: string
    }>

    expect(icons.map((icon) => [icon.src, icon.sizes, icon.purpose])).toEqual([
      ["/pwa-192x192.png", "192x192", "any"],
      ["/pwa-512x512.png", "512x512", "any"],
      ["/pwa-maskable-512x512.png", "512x512", "maskable"],
    ])

    expect(pngSize("pwa-192x192.png")).toEqual({ width: 192, height: 192 })
    expect(pngSize("pwa-512x512.png")).toEqual({ width: 512, height: 512 })
    expect(pngSize("pwa-maskable-512x512.png")).toEqual({
      width: 512,
      height: 512,
    })
    expect(pngSize("apple-touch-icon-180x180.png")).toEqual({
      width: 180,
      height: 180,
    })
    expect(existsSync(join(appRoot, "public", "icon.svg"))).toBe(true)
  })
})

describe("pwaOptions registration and caching", () => {
  it("never skips waiting on its own: the app, not the worker, decides when to update", () => {
    expect(pwaOptions.registerType).toBe("prompt")
    expect(pwaOptions.injectRegister).toBe(false)
  })

  it("precaches the shell including fonts and the manifest", () => {
    const workbox = pwaOptions.workbox as {
      globPatterns: string[]
      navigateFallback: string
    }

    expect(workbox.globPatterns.join(",")).toContain("woff2")
    expect(workbox.navigateFallback).toBe("/index.html")
  })
})

describe("index.html", () => {
  const html = readFileSync(join(appRoot, "index.html"), "utf8")

  it("self-hosts type: no Google Fonts links remain (the offline shell must not depend on them)", () => {
    expect(html).not.toContain("fonts.googleapis.com")
    expect(html).not.toContain("fonts.gstatic.com")
  })

  it("allows pinch zoom and uses a dark-on-light status bar over the white app bar", () => {
    expect(html).not.toContain("maximum-scale")
    expect(html).toContain('content="default"')
    expect(html).toContain('rel="apple-touch-icon"')
    expect(html).toContain('rel="icon"')
  })
})

interface RequestLike {
  readonly method: string
  readonly headers: { has(name: string): boolean }
}

function check(
  path: string,
  request: RequestLike = { method: "GET", headers: new Headers() },
): boolean {
  return isCacheableApiRequest({
    url: new URL(path, "https://quiz.example"),
    request,
  })
}

describe("isCacheableApiRequest (the only API data the worker may keep)", () => {
  it.each([
    "/api/tests",
    "/api/tests?cursor=abc",
    "/api/me",
    "/api/attempts?limit=20",
    "/api/attempts/3f1c/result",
    "/api/attempts/3f1c/review",
  ])("caches %s", (path) => {
    expect(check(path)).toBe(true)
  })

  it.each([
    "/api/tests/practice-1",
    "/api/tests/practice-1/offline-bundle",
    "/api/attempts/3f1c",
    "/api/attempts/3f1c/position",
    "/api/attempts/3f1c/responses",
    "/api/attempts/3f1c/stimuli/s1/play",
    "/api/attempts/3f1c/submit",
    "/api/session",
    "/api/media/q1.mp3?exp=1&sig=ab",
    "/api/admin/overview",
    "/assets/index-abc.js",
  ])("never caches %s", (path) => {
    expect(check(path)).toBe(false)
  })

  it("never caches a non-GET or a Range request", () => {
    expect(check("/api/me", { method: "POST", headers: new Headers() })).toBe(
      false,
    )
    expect(
      check("/api/me", {
        method: "GET",
        headers: new Headers({ range: "bytes=0-9" }),
      }),
    ).toBe(false)
  })
})

describe("workbox policy", () => {
  const workbox = pwaOptions.workbox as {
    runtimeCaching: Array<{
      urlPattern: unknown
      handler: string
      options: {
        cacheName: string
        networkTimeoutSeconds: number
        expiration: { maxEntries: number; maxAgeSeconds: number }
        cacheableResponse: { statuses: number[] }
      }
    }>
    navigateFallbackDenylist: RegExp[]
  }

  it("has exactly one runtime route: NetworkFirst, 4 s timeout, 60 entries, 7 days, 200s only", () => {
    expect(workbox.runtimeCaching).toHaveLength(1)

    const [route] = workbox.runtimeCaching

    expect(route.urlPattern).toBe(isCacheableApiRequest)
    expect(route.handler).toBe("NetworkFirst")
    expect(route.options.cacheName).toBe("pp-api-v1")
    expect(route.options.networkTimeoutSeconds).toBe(4)
    expect(route.options.expiration).toEqual({
      maxEntries: 60,
      maxAgeSeconds: 7 * 24 * 60 * 60,
    })
    expect(route.options.cacheableResponse).toEqual({ statuses: [200] })
  })

  it("keeps /api, /media and /health out of the navigation fallback", () => {
    const denied = (path: string) =>
      workbox.navigateFallbackDenylist.some((pattern) => pattern.test(path))

    expect(denied("/api/tests")).toBe(true)
    expect(denied("/media/x.mp3")).toBe(true)
    expect(denied("/health")).toBe(true)
    expect(denied("/history")).toBe(false)
    expect(denied("/callback")).toBe(false)
  })
})
