import { describe, expect, it } from "vitest"

const REQUIRED_LOCALES = ["de", "en", "es", "fr", "it", "ja"]

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/u

const modules = import.meta.glob("./*/*.json", { eager: true })

interface LocaleFile {
  readonly locale: string
  readonly namespace: string
}

function parseLocaleFile(path: string): LocaleFile | undefined {
  const match = /^\.\/(\w+)\/(\w+)\.json$/u.exec(path)

  if (!match) {
    return undefined
  }

  const [, locale, namespace] = match

  return locale && namespace ? { locale, namespace } : undefined
}

/**
 * Plural forms are resolved per-language by i18next: English and German
 * need `_one`/`_other`, Japanese needs no suffix at all (CLDR "other" only).
 * Stripping the suffix before comparing lets locale parity be judged on the
 * concept being translated, not on how many plural forms a language has.
 */
function flatten(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") {
    return [prefix]
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key),
  )
}

function keysByLocale(): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()

  for (const [path, mod] of Object.entries(modules)) {
    const parsed = parseLocaleFile(path)

    if (!parsed) {
      continue
    }

    const { locale, namespace } = parsed
    const content = (mod as { default: unknown }).default
    const set = result.get(locale) ?? new Set<string>()

    for (const key of flatten(content)) {
      set.add(`${namespace}:${key.replace(PLURAL_SUFFIX, "")}`)
    }

    result.set(locale, set)
  }

  return result
}

describe("locale parity", () => {
  it("ships every required locale", () => {
    const locales = [...keysByLocale().keys()].sort()

    expect(locales).toEqual([...REQUIRED_LOCALES].sort())
  })

  it("defines an identical set of translation keys across all six locales", () => {
    const byLocale = keysByLocale()
    const [reference, ...rest] = REQUIRED_LOCALES

    if (!reference) {
      throw new Error("REQUIRED_LOCALES must not be empty")
    }

    const referenceKeys = byLocale.get(reference) ?? new Set<string>()

    for (const locale of rest) {
      const keys = byLocale.get(locale) ?? new Set<string>()
      const missing = [...referenceKeys].filter((key) => !keys.has(key)).sort()
      const extra = [...keys].filter((key) => !referenceKeys.has(key)).sort()

      expect({ locale, missing, extra }).toEqual({
        locale,
        missing: [],
        extra: [],
      })
    }
  })
})
