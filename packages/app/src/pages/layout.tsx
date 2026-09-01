import { Outlet } from "@tanstack/react-router"
import type { ReactNode } from "react"

export interface AppShellProps {
  readonly children?: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return <div className="app-shell">{children}</div>
}

export function AppLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
