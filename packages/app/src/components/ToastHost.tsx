import type { JSX } from "react"
import type { ToastSnapshot } from "../lib/toast.js"
import { Icon } from "./Icon.js"

export interface ToastHostProps {
  readonly toast: ToastSnapshot | null
}

/**
 * The live region is ALWAYS mounted and starts empty; a toast is written
 * into it. A region mounted together with its text (or remounted per toast)
 * is not reliably announced -- iOS VoiceOver drops it. Only the visual toast
 * inside is keyed, so each one replays its entrance.
 */
export function ToastHost({ toast }: ToastHostProps): JSX.Element {
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toast ? (
        <div key={toast.id} className="toast">
          <Icon name={toast.icon} />
          <span>{toast.message}</span>
        </div>
      ) : null}
    </div>
  )
}
