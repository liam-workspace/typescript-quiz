import { useId } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./Icon.js"

export type TimeUpAction =
  | { readonly kind: "link"; readonly href: string; readonly label: string }
  | {
      readonly kind: "button"
      readonly label: string
      readonly onClick: () => void
    }

/**
 * The result is not ready because this phone still holds unsent work: a
 * disabled primary button that says why, and either a way to check again or
 * (when the server refused the journal) the ask-an-adult alert.
 */
export interface TimeUpWaiting {
  readonly seeResultLabel: string
  readonly reason: string
  readonly checkAgainLabel: string
  readonly onCheckAgain: () => void
  /** The server refused the journal: nothing to retry, no Check again. */
  readonly failed: boolean
  /** A re-check failed with nothing left to send: say so, stay retryable. */
  readonly retryMessage: string | null
}

export interface TimeUpViewProps {
  readonly heading: string
  readonly message: string
  readonly messageRole?: "status" | "alert"
  readonly title?: string
  readonly summary: {
    readonly answered: number
    readonly blank: number
  } | null
  readonly action: TimeUpAction | null
  /** Takes the place of `action` while the result waits for a sync. */
  readonly waiting?: TimeUpWaiting
}

export function TimeUpView({
  heading,
  message,
  messageRole = "status",
  title,
  summary,
  action,
  waiting,
}: TimeUpViewProps) {
  const { t } = useTranslation("runner")

  return (
    <div className="m-page">
      <header className="m-appbar">
        <span className="m-brand truncate">{title ?? t("library.brand")}</span>
        <span className="grow" />
        <span
          role="timer"
          aria-label={t("timeUp.clockLabel")}
          className="m-timer"
          data-low="true"
        >
          <Icon name="clock" small />
          <span>00:00</span>
        </span>
      </header>
      <main className="m-body text-center">
        <div
          className="m-logo mx-auto my-5"
          data-tone="clay"
          aria-hidden="true"
        >
          <Icon name="clock" />
        </div>
        <h1 className="m-title" tabIndex={-1} data-page-title>
          {heading}
        </h1>
        <p className="m-sub" role={messageRole}>
          {message}
        </p>
        {summary ? (
          <div className="m-tiles">
            <div className="m-tile">
              <span>{t("timeUp.answered")}</span>
              <b>{summary.answered}</b>
            </div>
            <div className="m-tile">
              <span>{t("timeUp.leftBlank")}</span>
              <b>{summary.blank}</b>
            </div>
          </div>
        ) : null}
      </main>
      {waiting ? <WaitingFooter waiting={waiting} /> : null}
      {!waiting && action ? <ActionFooter action={action} /> : null}
    </div>
  )
}

function ActionFooter({ action }: { readonly action: TimeUpAction }) {
  return (
    <footer className="m-actionbar">
      {action.kind === "link" ? (
        <a href={action.href} className="m-btn">
          {action.label}
        </a>
      ) : (
        <button type="button" className="m-btn" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </footer>
  )
}

function WaitingFooter({ waiting }: { readonly waiting: TimeUpWaiting }) {
  const reasonId = useId()

  return (
    <footer
      className="m-actionbar"
      style={{ flexDirection: "column", alignItems: "stretch" }}
    >
      <button
        type="button"
        className="m-btn"
        disabled
        aria-describedby={reasonId}
      >
        {waiting.seeResultLabel}
      </button>
      <p id={reasonId} className="m-reason text-center">
        {waiting.reason}
      </p>
      {waiting.failed ? null : (
        <>
          {waiting.retryMessage ? (
            <p role="alert" className="m-alert">
              {waiting.retryMessage}
            </p>
          ) : null}
          <button
            type="button"
            className="m-btn"
            data-variant="secondary"
            onClick={waiting.onCheckAgain}
          >
            {waiting.checkAgainLabel}
          </button>
        </>
      )}
    </footer>
  )
}
