import { describe, expect, it } from "vitest"
import { shouldServeSpaShell } from "../src/spa/spa-fallback.filter.js"
import { spaStaticHeaders } from "../src/spa/static-headers.js"

function headersFor(file: string): Record<string, string> {
  const set: Record<string, string> = {}

  spaStaticHeaders(
    {
      setHeader: (n, v) => {
        set[n] = v
      },
    },
    `/app/public/${file}`,
    "/app/public",
  )

  return set
}

describe("spaStaticHeaders", () => {
  it.each([
    "sw.js",
    "manifest.webmanifest",
    "index.html",
    "workbox-3d4e5f.js",
    "push-sw.js",
  ])(
    "serves %s with no-cache so an update is seen on the next load",
    (file) => {
      expect(headersFor(file)["Cache-Control"]).toBe("no-cache")
    },
  )

  it("lets the worker control the whole origin", () => {
    expect(headersFor("sw.js")["Service-Worker-Allowed"]).toBe("/")
  })

  it("does not widen the worker scope for the imported push handlers", () => {
    expect(headersFor("push-sw.js")["Service-Worker-Allowed"]).toBeUndefined()
  })

  it("serves hashed build assets as immutable", () => {
    expect(headersFor("assets/index-9f8e7d.js")["Cache-Control"]).toBe(
      "public, max-age=31536000, immutable",
    )
  })

  it("leaves other files (icons) on the default policy", () => {
    expect(headersFor("pwa-192x192.png")["Cache-Control"]).toBeUndefined()
  })
})

describe("shouldServeSpaShell", () => {
  it("serves the shell for a client route", () => {
    expect(shouldServeSpaShell("GET", "/profile")).toBe(true)
  })

  it.each([
    "/api/x",
    "/media/x",
    "/sw.js",
    "/manifest.webmanifest",
    "/workbox-abc123.js",
    "/push-sw.js",
  ])(
    "does not answer %s with index.html (a worker or manifest request must 404, not parse as HTML)",
    (path) => {
      expect(shouldServeSpaShell("GET", path)).toBe(false)
    },
  )

  it("never serves the shell for a non-GET", () => {
    expect(shouldServeSpaShell("POST", "/profile")).toBe(false)
  })
})
