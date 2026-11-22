import { describe, expect, it } from "vitest"
import i18n from "../i18n.js"

const REQUIRED_LOCALES = ["de", "en", "es", "fr", "it", "ja"]

const REQUIRED_DEVICE_LABEL_KEYS = [
  "runner:navigator.questionGridLabel",
  "runner:navigator.legendLabel",
]

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

/** Every key of one locale file, as `namespace:key`, plural suffixes kept. */
function namespacedKeys(path: string, mod: unknown): string[] {
  const namespace = parseLocaleFile(path)?.namespace ?? ""

  return flatten((mod as { default: unknown }).default).map(
    (key) => `${namespace}:${key}`,
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

  it("translates the accessible labels introduced by the device overlays", () => {
    const byLocale = keysByLocale()

    for (const locale of REQUIRED_LOCALES) {
      const keys = byLocale.get(locale) ?? new Set<string>()

      expect(
        [...REQUIRED_DEVICE_LABEL_KEYS].filter((key) => !keys.has(key)),
      ).toEqual([])
    }
  })

  it("uses ONE plural convention: every key pluralised in English is `_other` in Japanese (D8)", () => {
    const flat = (locale: string): string[] =>
      Object.entries(modules)
        .filter(([path]) => parseLocaleFile(path)?.locale === locale)
        .flatMap(([path, mod]) => namespacedKeys(path, mod))
    const en = flat("en")
    const ja = new Set(flat("ja"))
    const pluralBases = en
      .filter((key) => key.endsWith("_one"))
      .map((key) => key.slice(0, -"_one".length))

    expect(pluralBases.length).toBeGreaterThan(0)
    expect(pluralBases.filter((base) => !ja.has(`${base}_other`))).toEqual([])
    expect(pluralBases.filter((base) => ja.has(base))).toEqual([])
  })

  it("still resolves the renamed Japanese plurals through count (D8)", async () => {
    await i18n.loadLanguages("ja")
    const t = i18n.getFixedT("ja", "runner")

    expect(t("listening.playsLeftHint", { count: 2 })).toBe(
      "残り2回再生できます。一時停止はできません。",
    )
    expect(t("runner.finishSectionBlank", { count: 1 })).toBe(
      "1問がまだ空欄です。このセクションには戻れません。",
    )
  })
})
