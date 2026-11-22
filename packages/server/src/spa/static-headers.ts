import { basename, relative, sep } from "node:path"

export interface HeaderSink {
  setHeader(name: string, value: string): unknown
}

// The push handlers (push-sw.js) are pulled into the worker by
// importScripts: a stale copy would keep an old push handler alive after the
// worker itself updated.
const REVALIDATE = new Set([
  "sw.js",
  "push-sw.js",
  "manifest.webmanifest",
  "index.html",
])
const WORKBOX = /^workbox-[\w-]+\.js$/u

/**
 * Cache policy for the built SPA (spec D1). The worker script, its runtime
 * and its imported push handlers, the manifest and the shell are always
 * revalidated — a worker cached for a day would pin students on an old app
 * for a day. Only hashed files under /assets are immutable.
 */
export function spaStaticHeaders(
  res: HeaderSink,
  filePath: string,
  root: string,
): void {
  const name = basename(filePath)

  if (REVALIDATE.has(name) || WORKBOX.test(name)) {
    res.setHeader("Cache-Control", "no-cache")

    if (name === "sw.js") {
      res.setHeader("Service-Worker-Allowed", "/")
    }

    return
  }

  if (relative(root, filePath).split(sep)[0] === "assets") {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
  }
}
