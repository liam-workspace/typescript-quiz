import type { JSX } from "react"
import type { ToastSnapshot } from "../lib/toast.js"
import { Icon } from "./Icon.js"

export interface ToastHostProps {
  readonly toast: ToastSnapshot | null
}

export function ToastHost({ toast }: ToastHostProps): JSX.Element | null {
  if (!toast) {
    return null
  }

  return (
    <div key={toast.id} className="toast" role="status">
      <Icon name={toast.icon} />
      <span>{toast.message}</span>
    </div>
  )
}
