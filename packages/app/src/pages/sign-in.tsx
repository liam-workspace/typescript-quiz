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
    <div className="bg-surface text-ink flex min-h-screen items-center justify-center px-4">
      <div className="max-w-xs text-center">
        <h1 className="text-ink text-[31px] font-extrabold tracking-[-0.02em]">
          {t("library.brand")}
        </h1>
        <p className="text-ink-2 mt-2 mb-[18px] text-[15px] leading-relaxed">
          {t("signIn.subtitle")}
        </p>
        <button
          type="button"
          className="border-teal bg-teal text-paper focus-visible:outline-teal inline-flex size-11 w-full touch-manipulation items-center justify-center rounded-[9px] border px-5 text-sm font-bold select-none hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-70"
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
