import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { startSignIn } from "../lib/auth.js"

/**
 * Prototype `docs/prototype/index.html#s-signin`. Copy is settled apart
 * from the button: the prototype's "Continue with Google" predates
 * Microsoft support. `auth-dev.icovn.me`/`auth.icovn.me` presents its OWN
 * Google-or-Microsoft chooser after this one authorize request (confirmed
 * live -- see the plan's "The registration" section), so ONE
 * provider-neutral button is correct, not a placeholder for two.
 */
export interface SignInScreenProps {
  readonly onSignIn: () => void
  readonly starting: boolean
  readonly failed?: boolean
}

export function SignInScreen({
  onSignIn,
  starting,
  failed,
}: SignInScreenProps) {
  const { t } = useTranslation("runner")

  return (
    <div className="m-page">
      <main className="m-hero">
        <div className="m-logo" aria-hidden="true">
          {t("library.brand").charAt(0)}
        </div>
        <h1 className="m-title" tabIndex={-1} data-page-title>
          {t("library.brand")}
        </h1>
        <p className="m-sub">{t("signIn.subtitle")}</p>
        {failed ? (
          <p role="alert" className="m-alert">
            {t("signIn.error")}
          </p>
        ) : null}
        <button
          type="button"
          className="m-btn"
          data-block="true"
          disabled={starting}
          aria-busy={starting}
          onClick={onSignIn}
        >
          {t(starting ? "signIn.starting" : "signIn.button")}
        </button>
        <p className="m-reason">{t("signIn.reassurance")}</p>
      </main>
    </div>
  )
}

export const Route = createFileRoute("/sign-in")({
  component: RouteComponent,
})

function RouteComponent() {
  const [starting, setStarting] = useState(false)
  const [failed, setFailed] = useState(false)

  function handleSignIn(): void {
    setStarting(true)
    setFailed(false)

    startSignIn().catch(() => {
      setStarting(false)
      setFailed(true)
    })
  }

  return (
    <SignInScreen onSignIn={handleSignIn} starting={starting} failed={failed} />
  )
}
