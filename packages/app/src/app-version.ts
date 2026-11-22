declare const __APP_VERSION__: string

/** Injected by vite.config.ts `define`; Vitest does not define it. */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev"
