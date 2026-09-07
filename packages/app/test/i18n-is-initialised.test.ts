import { describe, expect, it } from "vitest"
// Vite's `?raw` rather than node:fs -- this is a browser package with no
// Node types, and the source text is what needs asserting.
import mainSource from "../src/main.tsx?raw"

/**
 * The app shipped with i18next never initialised. `src/i18n.ts` calls
 * `i18n.init()` at module scope, and `main.tsx` did not import it -- so every
 * screen rendered raw keys: a child saw `signIn.button` where "Sign in"
 * belonged.
 *
 * Nothing caught it, and the reason is worth stating plainly. 752 tests
 * passed, all four gates passed, the six locales were in parity, and
 * `i18n-lint` reported zero untranslated strings -- because every component
 * test builds its OWN `i18next` instance inline with the keys it needs. The
 * suite was supplying the production code the app had forgotten, which is
 * the same shape as an answer pipeline with zero call sites.
 *
 * So this test deliberately asserts against the real ENTRY POINT rather than
 * any component: does the thing that actually boots the app arrange for
 * translations to exist? A component test cannot answer that, however many
 * of them there are.
 */
describe("app startup", () => {
  it("imports the i18n module that initialises i18next", () => {
    // A side-effect import, not a named one: i18n.ts initialises on load and
    // exports only the instance, so `import "…/i18n"` is the whole contract.
    expect(mainSource).toMatch(/import\s+["'][^"']*\/i18n["']/u)
  })

  it("actually resolves a real key through the shipped configuration", async () => {
    const i18n = (await import("../src/i18n.js")).default

    // Not a fixture instance built by this test -- the module the app loads.
    // If its glob, namespace mapping or init ever breaks, this fails while a
    // component test using its own inline instance would carry on passing.
    expect(i18n.isInitialized).toBe(true)
    expect(i18n.t("signIn.button", { ns: "runner", lng: "en" })).toBe("Sign in")
    expect(i18n.t("library.brand", { ns: "runner", lng: "en" })).toBe(
      "Primary Practice",
    )
  })
})
