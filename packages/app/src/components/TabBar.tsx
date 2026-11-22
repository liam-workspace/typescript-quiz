import type { JSX } from "react"
import { TAB_HREF, type ShellTab } from "../lib/shell-routes.js"
import { Icon, type IconName } from "./Icon.js"

export interface TabBarProps {
  readonly active: ShellTab
  readonly labels: {
    readonly library: string
    readonly history: string
    readonly profile: string
    readonly nav: string
  }
  readonly onNavigate: (tab: ShellTab) => void
}

const TABS: ReadonlyArray<{ key: ShellTab; icon: IconName }> = [
  { key: "library", icon: "home" },
  { key: "history", icon: "clock" },
  { key: "profile", icon: "user" },
]

export function TabBar({
  active,
  labels,
  onNavigate,
}: TabBarProps): JSX.Element {
  return (
    <nav className="tabbar" aria-label={labels.nav}>
      {TABS.map(({ key, icon }) => (
        <a
          key={key}
          href={TAB_HREF[key]}
          aria-current={active === key ? "page" : undefined}
          onClick={(event) => {
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return
            }

            event.preventDefault()
            onNavigate(key)
          }}
        >
          <Icon name={icon} />
          {labels[key]}
        </a>
      ))}
    </nav>
  )
}
