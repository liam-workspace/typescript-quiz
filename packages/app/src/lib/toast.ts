export type ToastIcon =
  | "check"
  | "wifioff"
  | "cloud"
  | "trash"
  | "bell"
  | "refresh"
  | "clock"
  | "alert"

export interface ToastSnapshot {
  readonly id: number
  readonly message: string
  readonly icon: ToastIcon
}

type Listener = () => void

const TOAST_MS = 3800

let current: ToastSnapshot | null = null
let nextId = 1
let timer: ReturnType<typeof setTimeout> | undefined = undefined
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of [...listeners]) {
    listener()
  }
}

export const toastStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot(): ToastSnapshot | null {
    return current
  },
  resetForTests(): void {
    clearTimeout(timer)
    current = null
    emit()
  },
  show(message: string, icon: ToastIcon = "check"): void {
    clearTimeout(timer)
    current = { id: nextId, message, icon }
    nextId += 1
    emit()
    timer = setTimeout(() => {
      current = null
      emit()
    }, TOAST_MS)
  },
}
