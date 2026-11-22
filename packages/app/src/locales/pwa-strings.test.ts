import { describe, expect, it } from "vitest"

const LOCALES = ["de", "en", "es", "fr", "it", "ja"] as const

const REQUIRED_KEYS = [
  "tabs.nav",
  "tabs.library",
  "tabs.history",
  "tabs.profile",
  "pwa.sheet.close",
  "pwa.install.title",
  "pwa.install.body",
  "pwa.install.button",
  "pwa.install.notNow",
  "pwa.install.close",
  "pwa.install.installed",
  "pwa.install.runningAsApp",
  "pwa.install.notInstalled",
  "pwa.install.ios.title",
  "pwa.install.ios.hint",
  "pwa.install.ios.step1",
  "pwa.install.ios.step2",
  "pwa.install.ios.step3",
  "pwa.install.ios.done",
  "pwa.install.manual.title",
  "pwa.install.manual.body",
  "pwa.update.ready",
  "pwa.update.refresh",
  "pwa.update.deferred",
  "pwa.update.applied",
  "pwa.offline.browsing",
  "pwa.offline.inTest",
  "pwa.offline.waiting",
  "pwa.live.offline",
  "pwa.live.online",
  "toast.installed",
  "toast.savedOffline",
  "toast.savePaused",
  "toast.removedOffline",
  "toast.remindersOn",
  "toast.remindersOff",
  "toast.remindersBlocked",
  "profile.title",
  "profile.signedInWith",
  "profile.error",
  "profile.section.app",
  "profile.section.offline",
  "profile.install.title",
  "profile.reminders.title",
  "profile.reminders.on",
  "profile.reminders.off",
  "profile.reminders.denied",
  "profile.reminders.needsInstall",
  "profile.reminders.unsupported",
  "profile.reminders.permission.title",
  "profile.reminders.permission.body",
  "profile.reminders.permission.allow",
  "profile.reminders.permission.deny",
  "profile.version.title",
  "profile.version.upToDate",
  "profile.version.updateReady",
  "profile.offline.empty",
  "profile.offline.item",
  "profile.offline.remove",
  "profile.language",
  "profile.admin",
  "profile.signOut",
  "profile.signOutConfirm.title",
  "profile.signOutConfirm.body",
  "profile.signOutConfirm.cancel",
]

// I18next plural families: every language needs `_other`; the rest vary.
const PLURAL_KEYS = ["toast.backOnline"]

const modules = import.meta.glob("./*/runner.json", { eager: true }) as Partial<
  Record<string, { default: Record<string, string> }>
>

function catalogue(locale: string): Record<string, string | undefined> {
  return modules[`./${locale}/runner.json`]?.default ?? {}
}

describe("PWA UI strings", () => {
  it.each(LOCALES)(
    "%s defines every shell/profile key with a non-empty value",
    (locale) => {
      const strings = catalogue(locale)
      const missing = REQUIRED_KEYS.filter((key) => !strings[key]?.trim())

      expect(missing).toEqual([])
    },
  )

  it.each(LOCALES)("%s defines the plural keys it needs", (locale) => {
    const strings = catalogue(locale)

    for (const key of PLURAL_KEYS) {
      expect(strings[`${key}_other`]?.trim(), `${key}_other`).toBeTruthy()
    }
  })

  it("keeps interpolation placeholders identical across locales", () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\{(\w+)\}\}/gu)].map((m) => m[1]).sort()
    const english = catalogue("en")

    for (const locale of LOCALES) {
      const strings = catalogue(locale)

      for (const key of [...REQUIRED_KEYS, "toast.backOnline_other"]) {
        expect({ locale, key, vars: placeholders(strings[key] ?? "") }).toEqual(
          {
            locale,
            key,
            vars: placeholders(english[key] ?? ""),
          },
        )
      }
    }
  })

  it("never ships English text in a translated locale for the new copy", () => {
    const english = catalogue("en")
    const keys = [
      ...REQUIRED_KEYS,
      "toast.backOnline_one",
      "toast.backOnline_other",
    ]
    // Values that are legitimately identical to English (loanwords or pure
    // placeholders). Keep this list explicit; anything else must be translated.
    const sameAsEnglish = new Set([
      "de:profile.section.app",
      "es:profile.section.app",
      "it:profile.section.app",
      "de:profile.version.title",
      "fr:profile.version.title",
      "de:profile.offline.item",
      "es:profile.offline.item",
      "it:profile.offline.item",
      "ja:profile.offline.item",
    ])
    const untranslated: string[] = []

    for (const locale of LOCALES.filter((l) => l !== "en")) {
      for (const key of keys) {
        const value = catalogue(locale)[key]

        if (
          value !== undefined &&
          value === english[key] &&
          !sameAsEnglish.has(`${locale}:${key}`)
        ) {
          untranslated.push(`${locale}:${key}`)
        }
      }
    }

    expect(untranslated).toEqual([])
  })
})
