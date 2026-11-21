import { Link, createFileRoute } from "@tanstack/react-router"
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from "react"
import { useTranslation } from "react-i18next"
import { APP_VERSION } from "../app-version.js"
import { BottomSheet } from "../components/BottomSheet.js"
import { Icon } from "../components/Icon.js"
import { InstallSheet } from "../components/InstallSheet.js"
import { OfflineStorageList } from "../components/OfflineStorageList.js"
import { RemindersRow } from "../components/RemindersRow.js"
import type { Student } from "../lib/api-types.js"
import { signOut } from "../lib/auth.js"
import { SIGN_IN_PATH } from "../lib/authPaths.js"
import { startInstall } from "../lib/pwa/install-flow.js"
import { pwaStore, type PwaSnapshot } from "../lib/pwa/pwa-store.js"
import { reminders, type ReminderState } from "../lib/reminders.js"
import { getCurrentStudent } from "../lib/session-api.js"
import { toastStore } from "../lib/toast.js"

const REMINDER_TOAST: Partial<Record<ReminderState, string>> = {
  on: "toast.remindersOn",
  denied: "toast.remindersBlocked",
}

const LANGUAGES = ["en", "fr", "de", "es", "it", "ja"] as const

export interface ProfileScreenProps {
  readonly student: Student
  readonly pwa: PwaSnapshot
  readonly version: string
  readonly reminders: {
    readonly state: ReminderState
    readonly busy: boolean
    readonly onToggle: (next: boolean) => void
  }
  /** Task 16 injects the real saved-tests list; Task 6 passes an empty one. */
  readonly offlineStorage: ReactNode
  readonly onInstall: () => void
  readonly onRefresh: () => void
  readonly onSignOut: () => void
}

/** Prototype `vProfile()`. Language and the admin link are additive rows (spec §11). */
export function ProfileScreen({
  student,
  pwa,
  version,
  reminders: reminderProps,
  offlineStorage,
  onInstall,
  onRefresh,
  onSignOut,
}: ProfileScreenProps): JSX.Element {
  const { t, i18n } = useTranslation("runner")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const signOutTrigger = useRef<HTMLButtonElement>(null)
  const [language] = (i18n.resolvedLanguage ?? i18n.language).split("-")

  return (
    <div className="device-page">
      <header className="app-bar">
        <span className="app-brand">{t("profile.title")}</span>
      </header>

      <main className="device-main">
        <h1 className="screen-title" tabIndex={-1}>
          {t("profile.title")}
        </h1>

        <div className="my-3.5 flex items-center gap-3">
          <span
            className="avatar"
            style={{ width: 52, height: 52, fontSize: 22 }}
            aria-hidden="true"
          >
            {student.displayName[0]}
          </span>
          <div>
            <b className="text-lg">{student.displayName}</b>
            <p className="text-ink-2 text-[13.5px]">
              {t("profile.signedInWith")}
            </p>
          </div>
        </div>

        <h2 className="eyebrow mt-5.5 mb-2">{t("profile.section.app")}</h2>
        <div className="list">
          <div className="li">
            <span className="ticon">
              <Icon name="plus" />
            </span>
            <div className="t">
              {t("profile.install.title")}
              <small>
                {t(
                  pwa.standalone
                    ? "pwa.install.runningAsApp"
                    : "pwa.install.notInstalled",
                )}
              </small>
            </div>
            {pwa.standalone ? (
              <span className="chip good">
                <Icon name="check" small /> {t("pwa.install.installed")}
              </span>
            ) : (
              <button
                type="button"
                className="btn sm secondary"
                onClick={onInstall}
              >
                {t("pwa.install.button")}
              </button>
            )}
          </div>

          <RemindersRow
            state={reminderProps.state}
            busy={reminderProps.busy}
            onToggle={reminderProps.onToggle}
          />

          <div className="li">
            <span className="ticon">
              <Icon name="refresh" />
            </span>
            <div className="t">
              {t("profile.version.title")}
              <small>
                {t(
                  pwa.updateReady
                    ? "profile.version.updateReady"
                    : "profile.version.upToDate",
                  { version },
                )}
              </small>
            </div>
            {pwa.updateReady ? (
              <button type="button" className="btn sm" onClick={onRefresh}>
                {t("pwa.update.refresh")}
              </button>
            ) : null}
          </div>
        </div>

        <h2 className="eyebrow mt-5.5 mb-2">{t("profile.section.offline")}</h2>
        {offlineStorage}

        <h2 className="eyebrow mt-5.5 mb-2">{t("profile.language")}</h2>
        <div
          className="lang-group"
          role="group"
          aria-label={t("profile.language")}
        >
          {LANGUAGES.map((code) => (
            <button
              key={code}
              type="button"
              className="lang-btn"
              aria-pressed={language === code}
              onClick={() => {
                void i18n.changeLanguage(code)
              }}
            >
              {code}
            </button>
          ))}
        </div>

        {student.isAdmin ? (
          <Link to="/admin" className="btn secondary mt-5.5 block">
            {t("profile.admin")}
          </Link>
        ) : null}

        <button
          ref={signOutTrigger}
          type="button"
          className="btn secondary mt-5.5 block"
          onClick={() => {
            setConfirmOpen(true)
          }}
        >
          <Icon name="logout" /> {t("profile.signOut")}
        </button>
      </main>

      <BottomSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("profile.signOutConfirm.title")}
        closeLabel={t("pwa.sheet.close")}
        returnFocusRef={signOutTrigger}
      >
        <p>{t("profile.signOutConfirm.body")}</p>
        <div className="btnrow">
          <button type="button" className="btn danger" onClick={onSignOut}>
            {t("profile.signOut")}
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              setConfirmOpen(false)
            }}
          >
            {t("profile.signOutConfirm.cancel")}
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}

export function ProfileRouteError(): JSX.Element {
  const { t } = useTranslation("runner")

  return (
    <div className="device-page">
      <main className="center-main">
        <div className="device-card max-w-xl">
          <p role="alert">{t("profile.error")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="/profile" className="btn sm">
              {t("library.errorRetry")}
            </a>
            <a
              href={SIGN_IN_PATH}
              className="btn sm secondary"
              onClick={() => {
                signOut()
              }}
            >
              {t("menu.signOut")}
            </a>
          </div>
        </div>
      </main>
    </div>
  )
}

export function loadProfile(): Promise<Student> {
  return getCurrentStudent()
}

export const Route = createFileRoute("/profile")({
  loader: loadProfile,
  errorComponent: ProfileRouteError,
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation("runner")
  const student = Route.useLoaderData()
  const pwa = useSyncExternalStore(
    (listener) => pwaStore.subscribe(listener),
    () => pwaStore.getSnapshot(),
  )
  const [reminderState, setReminderState] =
    useState<ReminderState>("unsupported")
  const [busy, setBusy] = useState(false)
  const [installKind, setInstallKind] = useState<"ios" | "manual" | null>(null)

  useEffect(() => {
    let active = true

    void reminders.state().then((state) => {
      if (active) {
        setReminderState(state)
      }
    })

    return () => {
      active = false
    }
  }, [])

  async function handleInstall(): Promise<void> {
    const step = await startInstall()

    if (step === "accepted") {
      toastStore.show(t("toast.installed"), "check")
    } else if (step === "show-ios" || step === "show-manual") {
      setInstallKind(step === "show-ios" ? "ios" : "manual")
    }
  }

  async function handleToggle(next: boolean): Promise<void> {
    setBusy(true)

    try {
      const state = await (next ? reminders.enable() : reminders.disable())

      setReminderState(state)
      toastStore.show(t(REMINDER_TOAST[state] ?? "toast.remindersOff"), "bell")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ProfileScreen
        student={student}
        pwa={pwa}
        version={APP_VERSION}
        reminders={{
          state: reminderState,
          busy,
          onToggle: (next) => {
            void handleToggle(next)
          },
        }}
        offlineStorage={
          <OfflineStorageList items={[]} onRemove={() => undefined} />
        }
        onInstall={() => {
          void handleInstall()
        }}
        onRefresh={() => {
          void pwaStore.applyUpdate()
        }}
        onSignOut={() => {
          signOut()
          globalThis.location.assign(SIGN_IN_PATH)
        }}
      />
      <InstallSheet
        open={installKind !== null}
        onOpenChange={(open) => {
          if (!open) {
            setInstallKind(null)
          }
        }}
        kind={installKind ?? "manual"}
        onConfirm={() => {
          pwaStore.markInstalled()
          setInstallKind(null)
          toastStore.show(t("toast.installed"), "check")
        }}
      />
    </>
  )
}
