import { cmsPwaOptions } from "@liam-workspace/vite-preset-pwa"
import type { VitePWAOptions } from "vite-plugin-pwa"

/**
 * Task 1 of docs/superpowers/plans/2026-11-22-quiz-pwa-mobile.md.
 *
 * Manifest + app shell only. The preset's default `runtimeCaching` caches
 * EVERY /api GET NetworkFirst, which would keep one student's results in a
 * shared browser for the next student; it is replaced here (and filled
 * with an explicit allow-list in Task 2) rather than inherited.
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
    runtimeCaching: [],
  } as VitePWAOptions["workbox"],
  devOptions: { enabled: false },
}
