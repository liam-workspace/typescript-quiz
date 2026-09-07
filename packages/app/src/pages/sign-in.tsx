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
    <div className="device-page">
      <main className="center-main">
        <div className="w-full max-w-xs">
          <h1 className="screen-title text-[31px] tracking-[-0.02em]">
            {t("library.brand")}
          </h1>
          <p className="screen-subtitle mt-2 mb-[18px] text-[15px] leading-relaxed">
            {t("signIn.subtitle")}
          </p>
          <button
            type="button"
            className="device-button"
            data-variant="secondary"
            disabled={starting}
            aria-busy={starting}
            onClick={onSignIn}
          >
            {t(starting ? "signIn.starting" : "signIn.button")}
          </button>
          {failed ? (
            <p role="alert" className="text-bad mt-3 text-[12.5px]">
              {t("signIn.error")}
            </p>
          ) : null}
          <p className="text-faint mt-4 max-w-[38ch] text-[12.5px] leading-relaxed">
            {t("signIn.reassurance")}
          </p>
        </div>
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
