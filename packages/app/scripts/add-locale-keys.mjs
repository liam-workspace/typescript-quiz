/// <reference types="node" />
// Merges a { locale: { key: value } } patch into src/locales/<locale>/<namespace>.json
// for every locale, so the six files can never drift apart.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const LOCALES = ["de", "en", "es", "fr", "it", "ja"]
const [namespace, patchPath] = process.argv.slice(2)

if (!namespace || !patchPath) {
  console.error("usage: node add-locale-keys.mjs <namespace> <patch.json>")
  process.exit(2)
}

/**
 * Reads a JSON file that must hold an object. Typed (rather than a bare
 * `JSON.parse`, which is `any`) so the type-aware lint can follow the values.
 *
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function readJsonObject(path) {
  /** @type {unknown} */
  const value = JSON.parse(readFileSync(path, "utf8"))

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} does not hold a JSON object`)
  }

  return Object.fromEntries(Object.entries(value))
}

const patch = readJsonObject(patchPath)
/** @type {Map<string, object>} */
const additionsByLocale = new Map()

for (const locale of LOCALES) {
  const additions = patch[locale]

  if (additions !== null && typeof additions === "object") {
    additionsByLocale.set(locale, additions)
  }
}

// Checked for every locale before any file is written, so a bad patch can
// never leave the six files half-updated.
const missing = LOCALES.filter((locale) => !additionsByLocale.has(locale))

if (missing.length > 0) {
  console.error(`patch is missing locales: ${missing.join(", ")}`)
  process.exit(1)
}

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "locales",
)

for (const locale of LOCALES) {
  const file = join(root, locale, `${namespace}.json`)
  const current = readJsonObject(file)
  const additions = additionsByLocale.get(locale)

  writeFileSync(
    file,
    `${JSON.stringify({ ...current, ...additions }, null, 2)}\n`,
  )
}
