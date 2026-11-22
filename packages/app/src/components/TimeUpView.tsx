import { useTranslation } from "react-i18next"
import { Icon } from "./Icon.js"

export type TimeUpAction =
  | { readonly kind: "link"; readonly href: string; readonly label: string }
  | {
      readonly kind: "button"
      readonly label: string
      readonly onClick: () => void
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
}

export function TimeUpView({
  heading,
  message,
  messageRole = "status",
  title,
  summary,
  action,
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
      {action ? (
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
      ) : null}
    </div>
  )
}
