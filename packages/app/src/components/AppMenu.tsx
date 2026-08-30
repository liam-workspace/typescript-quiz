import { DialogTitle, Sheet, SheetContent } from "@liam-public/browser-react-ui"
import type { JSX } from "react"
import { useTranslation } from "react-i18next"

/** The fields `GET /me` returns that this menu actually shows. */
export interface MenuStudent {
  displayName: string
  email: string
}

export interface AppMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  inTest: boolean
  clockStarted: boolean
  /**
   * Passed in, not read from an auth context. The brief reaches for
   * `useAuth()` from @liam-public/browser-react-auth on the stated
   * ASSUMPTION that plan 3 mounted an AuthProvider. It did not: nothing in
   * this app mounts one, and `useAuth` throws "useAuth must be used within
   * an AuthProvider" when none is present -- so that version crashed the
   * runner the moment this sheet opened, while its tests passed by mocking
   * the whole module away. It also violates the rule this directory lives
   * by: components/ is props-only and does not reach for its own data.
   * `undefined` while the shell has not resolved the student yet.
   */
  student: MenuStudent | undefined
  onSignOut: () => void
  onGoLibrary: () => void
  onGoHistory: () => void
  onLeaveTest: () => void
}

const LANGUAGES = ["en", "fr", "de", "es", "it", "ja"] as const

export function AppMenu({
  open,
  onOpenChange,
  inTest,
  clockStarted,
  student,
  onSignOut,
  onGoLibrary,
  onGoHistory,
  onLeaveTest,
}: AppMenuProps): JSX.Element {
  const { t, i18n } = useTranslation("runner")
  const [selectedLanguage] = (i18n.resolvedLanguage ?? i18n.language).split("-")

  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        aria-describedby={undefined}
        className="device-drawer-panel"
      >
        <DialogTitle>{t("menu.title")}</DialogTitle>

        <nav aria-label={t("menu.title")} className="device-drawer">
          <header className="device-drawer-student">
            <span aria-hidden="true" className="device-drawer-avatar">
              {student?.displayName[0] ?? "?"}
            </span>
            <span className="min-w-0">
              <b className="block truncate text-sm text-ink">
                {student?.displayName}
              </b>
              <span className="block truncate text-xs text-ink-2">
                {student?.email}
              </span>
            </span>
          </header>

          <div
            role="group"
            aria-label={t("menu.primaryNavigation", {
              defaultValue: "Main menu",
            })}
            className="device-drawer-actions"
          >
            <button
              type="button"
              className="size-11 w-full touch-manipulation rounded-md px-3 text-left text-sm font-semibold text-stone-800 select-none hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
              onClick={onGoLibrary}
            >
              {t("menu.library")}
            </button>
            <button
              type="button"
              className="size-11 w-full touch-manipulation rounded-md px-3 text-left text-sm font-semibold text-stone-800 select-none hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
              onClick={onGoHistory}
            >
              {t("menu.history")}
            </button>

            {inTest ? (
              <>
                <hr />
                <button
                  type="button"
                  className="size-11 w-full touch-manipulation rounded-md px-3 text-left text-sm font-semibold text-stone-800 select-none hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
                  onClick={onLeaveTest}
                >
                  {t("menu.leaveTest")}
                </button>
                <p>
                  {clockStarted
                    ? t("menu.leaveTestNoteRunning")
                    : t("menu.leaveTestNoteBeforeStart")}
                </p>
              </>
            ) : null}
          </div>

          <footer className="device-drawer-footer">
            <div id="app-menu-language-label">{t("menu.language")}</div>
            <div
              role="group"
              aria-labelledby="app-menu-language-label"
              className="device-drawer-languages"
            >
              {LANGUAGES.map((language) => {
                const selected = selectedLanguage === language

                return (
                  <button
                    key={language}
                    type="button"
                    aria-pressed={selected}
                    className={`size-11 touch-manipulation rounded-md border text-xs font-bold uppercase select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${
                      selected
                        ? "border-teal-700 bg-teal-100 text-teal-900"
                        : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100"
                    }`}
                    onClick={() => {
                      void i18n.changeLanguage(language)
                    }}
                  >
                    {language}
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              className="device-drawer-sign-out size-11 w-full touch-manipulation rounded-md px-3 text-left text-sm font-semibold text-red-600 select-none hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
              onClick={onSignOut}
            >
              {t("menu.signOut")}
            </button>
          </footer>
        </nav>
      </SheetContent>
    </Sheet>
  )
}
