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

const patch = JSON.parse(readFileSync(patchPath, "utf8"))
const missing = LOCALES.filter((locale) => !(locale in patch))

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
  const current = JSON.parse(readFileSync(file, "utf8"))

  writeFileSync(
    file,
    `${JSON.stringify({ ...current, ...patch[locale] }, null, 2)}\n`,
  )
}
