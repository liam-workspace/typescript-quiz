import type { JSX } from "react"
import { useTranslation } from "react-i18next"

export interface RouteErrorViewProps {
  readonly title?: string
  /** Announced as an alert. */
  readonly message: string
  /** A reload that costs nothing (the answer queue survives it). */
  readonly retry?: { readonly label: string; readonly onRetry: () => void }
}

/**
 * A screen whose load failed. Never a dead end: there is always a way back
 * to the library (the shell has no tab bar on attempt screens).
 */
export function RouteErrorView({
  title,
  message,
  retry,
}: RouteErrorViewProps): JSX.Element {
  const { t } = useTranslation("runner")

  return (
    <div className="m-page">
      <main className="m-body">
        {title ? (
          <h1 className="m-title" tabIndex={-1} data-page-title>
            {title}
          </h1>
        ) : null}
        <p role="alert" className="m-alert mt-3">
          {message}
        </p>
        <div className="m-sheet-actions">
          {retry ? (
            <button type="button" className="m-btn" onClick={retry.onRetry}>
              {retry.label}
            </button>
          ) : null}
          <a href="/" className="m-btn" data-variant="secondary">
            {t("result.backToLibrary")}
          </a>
        </div>
      </main>
    </div>
  )
}
