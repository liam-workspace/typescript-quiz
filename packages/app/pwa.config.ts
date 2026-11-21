import { cmsPwaOptions } from "@liam-workspace/vite-preset-pwa"
import type { VitePWAOptions } from "vite-plugin-pwa"

/**
 * PWA configuration: the web manifest, the precached app shell, and the
 * service worker's runtime caching policy.
 *
 * The preset's default `runtimeCaching` caches EVERY /api GET NetworkFirst,
 * which would keep one student's data in a shared browser for the next
 * student; it is replaced by an explicit allow-list
 * (`isCacheableApiRequest`) rather than inherited.
 *
 * `registerType: "prompt"`: a new worker waits; the app decides when to
 * apply it so a student is never reloaded mid-test (spec D3).
 */
const preset = cmsPwaOptions({
  name: "Primary Practice",
  shortName: "Primary Practice",
  description: "Listening and reading practice tests for TOEFL Primary.",
  themeColor: "#ffffff",
  backgroundColor: "#0f6e78",
  startUrl: "/",
  icons: [
    {
      src: "/pwa-192x192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/pwa-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/pwa-maskable-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
}) as { manifest: Record<string, unknown>; workbox: Record<string, unknown> }

interface WorkboxMatchContext {
  readonly url: URL
  readonly request: {
    readonly method: string
    readonly headers: { has(name: string): boolean }
  }
}

/**
 * The ONLY /api responses the worker may keep (spec D1). A function
 * declaration with inline regexes and no outside references on purpose:
 * Workbox `generateSW` serialises `urlPattern` into sw.js with
 * `Function#toString`, so any closure variable would be undefined there.
 */
export function isCacheableApiRequest({
  url,
  request,
}: WorkboxMatchContext): boolean {
  if (request.method !== "GET" || request.headers.has("range")) {
    return false
  }

  return (
    /^\/api\/(tests|me|attempts)$/u.test(url.pathname) ||
    /^\/api\/attempts\/[^/]+\/(result|review)$/u.test(url.pathname)
  )
}

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: "prompt",
  injectRegister: false,
  includeAssets: ["icon.svg", "apple-touch-icon-180x180.png"],
  manifest: {
    ...preset.manifest,
    id: "/",
    lang: "en",
    orientation: "portrait",
    categories: ["education"],
  } as VitePWAOptions["manifest"],
  workbox: {
    ...preset.workbox,
    globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2,webmanifest}"],
    maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    navigateFallbackDenylist: [/^\/api\//u, /^\/media\//u, /^\/health/u],
    runtimeCaching: [
      {
        urlPattern: isCacheableApiRequest,
        handler: "NetworkFirst",
        options: {
          cacheName: "pp-api-v1",
          networkTimeoutSeconds: 4,
          expiration: { maxEntries: 60, maxAgeSeconds: 7 * 24 * 60 * 60 },
          cacheableResponse: { statuses: [200] },
        },
      },
    ],
  } as VitePWAOptions["workbox"],
  devOptions: { enabled: false },
}
