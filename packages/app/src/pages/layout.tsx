import { Outlet, useRouter, useRouterState } from "@tanstack/react-router"
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { useTranslation } from "react-i18next"
import { OfflineBanner, UpdateBanner } from "../components/Banners.js"
import { Splash } from "../components/Splash.js"
import { TabBar } from "../components/TabBar.js"
import { ToastHost } from "../components/ToastHost.js"
import { networkStore } from "../lib/network.js"
import { pendingCountStore } from "../lib/pending-count.js"
import { pwaStore } from "../lib/pwa/pwa-store.js"
import {
  TAB_HREF,
  isAttemptPath,
  isRunPath,
  tabForPath,
  type ShellTab,
} from "../lib/shell-routes.js"
import { toastStore } from "../lib/toast.js"

export interface AppShellProps {
  readonly children?: ReactNode
  /** Phone-width column, centred on wider screens (student screens). */
  readonly column?: boolean
  /** Reserve room for the fixed tab bar. */
  readonly withTabBar?: boolean
}

export function AppShell({
  children,
  column = false,
  withTabBar = false,
}: AppShellProps) {
  const classes = [
    "app-shell",
    column ? "app-shell--column" : "",
    withTabBar ? "app-shell--tabs" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return <div className={classes}>{children}</div>
}

const SPLASH_MS = 600
let splashShown = false

/** Cold-start splash, only when launched from the home screen (prototype `#splash`). */
function useColdStartSplash(standalone: boolean): boolean {
  const [visible, setVisible] = useState(() => standalone && !splashShown)

  useEffect(() => {
    if (!visible) {
      return undefined
    }

    splashShown = true

    const timer = setTimeout(() => {
      setVisible(false)
    }, SPLASH_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [visible])

  return visible
}

export function AppLayout() {
  const { t } = useTranslation("runner")
  const router = useRouter()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const network = useSyncExternalStore(
    (listener) => networkStore.subscribe(listener),
    () => networkStore.getSnapshot(),
  )
  const pwa = useSyncExternalStore(
    (listener) => pwaStore.subscribe(listener),
    () => pwaStore.getSnapshot(),
  )
  const toast = useSyncExternalStore(
    (listener) => toastStore.subscribe(listener),
    () => toastStore.getSnapshot(),
  )
  const pending = useSyncExternalStore(
    (listener) => pendingCountStore.subscribe(listener),
    () => pendingCountStore.getSnapshot(),
  )
  const splashVisible = useColdStartSplash(pwa.standalone)
  const [announcement, setAnnouncement] = useState("")
  const previousOnline = useRef(network.online)

  const admin = pathname.startsWith("/admin")
  const tab = admin ? null : tabForPath(pathname)
  const inAttempt = isAttemptPath(pathname)

  useEffect(() => {
    if (previousOnline.current === network.online) {
      return
    }

    previousOnline.current = network.online
    setAnnouncement(t(network.online ? "pwa.live.online" : "pwa.live.offline"))
  }, [network.online, t])

  function handleNavigate(next: ShellTab): void {
    // `href` (not `to`) keeps this independent of the generated route tree;
    // router-core parses a same-origin path href and navigates in-app.
    void router.navigate({ href: TAB_HREF[next] })
  }

  return (
    <>
      <Splash visible={splashVisible} />
      <AppShell column={!admin} withTabBar={tab !== null}>
        {!admin && !network.online && !isRunPath(pathname) ? (
          <OfflineBanner variant="browsing" pendingCount={pending} />
        ) : null}
        {!admin && pwa.updateReady ? (
          <UpdateBanner
            deferred={inAttempt}
            onRefresh={() => {
              void pwaStore.applyUpdate()
            }}
          />
        ) : null}
        <Outlet />
      </AppShell>
      {tab ? (
        <TabBar
          active={tab}
          labels={{
            library: t("tabs.library"),
            history: t("tabs.history"),
            profile: t("tabs.profile"),
            nav: t("tabs.nav"),
          }}
          onNavigate={handleNavigate}
        />
      ) : null}
      <ToastHost toast={toast} />
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </>
  )
}
