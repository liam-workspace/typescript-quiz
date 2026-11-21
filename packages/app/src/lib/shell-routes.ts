export type ShellTab = "library" | "history" | "profile"

export const TAB_HREF: Record<ShellTab, string> = {
  library: "/",
  history: "/history",
  profile: "/profile",
}

/** Spec §5: the tab bar shows on exactly these three routes. */
export function tabForPath(pathname: string): ShellTab | null {
  const path = pathname.replace(/\/+$/u, "") || "/"

  if (path === "/") {
    return "library"
  }

  if (path === "/history") {
    return "history"
  }

  return path === "/profile" ? "profile" : null
}

/** The run screen renders its own in-test offline banner. */
export function isRunPath(pathname: string): boolean {
  return /^\/attempts\/[^/]+\/run\/?$/u.test(pathname)
}

export function isAttemptPath(pathname: string): boolean {
  return pathname.startsWith("/attempts/")
}
