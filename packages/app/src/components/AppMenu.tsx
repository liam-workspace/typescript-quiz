import { DialogTitle } from "@liam-public/browser-react-ui"
import { useRef, type JSX, type RefObject } from "react"
import { useTranslation } from "react-i18next"
import { DeviceSheet } from "./DeviceSheet.js"

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
  onOpenNavigator?: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
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
  onOpenNavigator,
  returnFocusRef,
}: AppMenuProps): JSX.Element {
  const { t, i18n } = useTranslation("runner")
  const [selectedLanguage] = (i18n.resolvedLanguage ?? i18n.language).split("-")
  const switchingPanelRef = useRef(false)

  return (
    <DeviceSheet
      open={open}
      onOpenChange={onOpenChange}
      closeLabel={t("menu.closeLabel")}
      side="left"
      ariaDescribedBy={undefined}
      returnFocusRef={returnFocusRef}
      suppressReturnFocusRef={switchingPanelRef}
      className="device-drawer-panel"
    >
      <DialogTitle>{t("menu.title")}</DialogTitle>

      <nav aria-label={t("menu.title")} className="device-drawer">
        <header className="device-drawer-student">
          <span aria-hidden="true" className="device-drawer-avatar">
            {student?.displayName[0] ?? "?"}
          </span>
          <span className="min-w-0">
            <b className="text-ink block truncate text-sm">
              {student?.displayName}
            </b>
            <span className="text-ink-2 block truncate text-xs">
              {student?.email}
            </span>
          </span>
        </header>

        <div
          role="group"
          aria-label={t("menu.primaryNavigation")}
          className="device-drawer-actions"
        >
          <button
            type="button"
            className="size-11 w-full"
            onClick={onGoLibrary}
          >
            {t("menu.library")}
          </button>
          <button
            type="button"
            className="size-11 w-full"
            onClick={onGoHistory}
          >
            {t("menu.history")}
          </button>

          {onOpenNavigator ? (
            <button
              type="button"
              className="size-11 w-full"
              onClick={() => {
                switchingPanelRef.current = true
                onOpenNavigator()
              }}
            >
              {t("navigator.openLabel")}
            </button>
          ) : null}

          {inTest ? (
            <>
              <hr />
              <button
                type="button"
                className="size-11 w-full"
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
                  className="device-language-button size-11"
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
            className="device-drawer-sign-out size-11 w-full"
            onClick={onSignOut}
          >
            {t("menu.signOut")}
          </button>
        </footer>
      </nav>
    </DeviceSheet>
  )
}
