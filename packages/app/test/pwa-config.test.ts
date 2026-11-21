import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { pwaOptions } from "../pwa.config.js"

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

  it("does not inherit the preset's blanket /api runtime cache", () => {
    const workbox = pwaOptions.workbox as { runtimeCaching?: unknown[] }

    expect(workbox.runtimeCaching).toEqual([])
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
