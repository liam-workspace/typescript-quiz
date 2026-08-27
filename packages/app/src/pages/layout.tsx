import { Card } from "@liam-public/browser-react-ui"
import { Outlet } from "@tanstack/react-router"
import type { ReactNode } from "react"

export interface AppShellProps {
  readonly children?: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <Card className="min-h-screen rounded-none border-0">
      <main>{children}</main>
    </Card>
  )
}

export function AppLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
