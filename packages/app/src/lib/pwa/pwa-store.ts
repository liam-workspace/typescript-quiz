export type PwaPlatform = "ios" | "android" | "other"

export interface PwaSnapshot {
  readonly standalone: boolean
  readonly canPromptInstall: boolean
  readonly platform: PwaPlatform
  readonly installDismissed: boolean
  readonly updateReady: boolean
}

type Listener = () => void

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>
}

export interface PwaStoreDeps {
  readonly win: {
    readonly navigator: {
      readonly userAgent: string
      readonly maxTouchPoints: number
      readonly standalone?: boolean
    }
    matchMedia(query: string): {
      readonly matches: boolean
      addEventListener(type: string, listener: () => void): void
    }
    addEventListener(type: string, listener: (event: Event) => void): void
  }
  readonly storage: Pick<Storage, "getItem" | "setItem"> | null
}

const DISMISS_KEY = "pp.install.dismissed"

export function detectPlatform(
  userAgent: string,
  maxTouchPoints: number,
): PwaPlatform {
  if (/iPhone|iPad|iPod/u.test(userAgent)) {
    return "ios"
  }

  // On iPadOS 13+ Safari reports a desktop Mac UA; only touch tells them apart.
  if (/Macintosh/u.test(userAgent) && maxTouchPoints > 1) {
    return "ios"
  }

  return /Android/u.test(userAgent) ? "android" : "other"
}

export function createPwaStore({ win, storage }: PwaStoreDeps) {
  const listeners = new Set<Listener>()
  let deferred: InstallPromptEvent | null = null
  let applyFn: (() => Promise<void>) | null = null
  let installedLive = false

  const readDismissed = (): boolean => {
    try {
      return storage?.getItem(DISMISS_KEY) === "1"
    } catch {
      return false
    }
  }

  const standaloneNow = (): boolean =>
    installedLive ||
    win.matchMedia("(display-mode: standalone)").matches ||
    win.navigator.standalone === true

  const platform = detectPlatform(
    win.navigator.userAgent,
    win.navigator.maxTouchPoints,
  )
  let dismissed = readDismissed()
  let snapshot: PwaSnapshot = build()

  function build(): PwaSnapshot {
    return {
      standalone: standaloneNow(),
      canPromptInstall: deferred !== null,
      platform,
      installDismissed: dismissed,
      updateReady: applyFn !== null,
    }
  }

  function publish(): void {
    const next = build()

    if (
      next.standalone === snapshot.standalone &&
      next.canPromptInstall === snapshot.canPromptInstall &&
      next.installDismissed === snapshot.installDismissed &&
      next.updateReady === snapshot.updateReady
    ) {
      return
    }

    snapshot = next

    for (const listener of [...listeners]) {
      listener()
    }
  }

  win.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault()
    deferred = event as InstallPromptEvent
    publish()
  })
  win.addEventListener("appinstalled", () => {
    installedLive = true
    deferred = null
    publish()
  })
  win
    .matchMedia("(display-mode: standalone)")
    .addEventListener("change", publish)

  const remember = (): void => {
    dismissed = true

    try {
      storage?.setItem(DISMISS_KEY, "1")
    } catch {
      // Storage unavailable: the card stays dismissed for this page load only.
    }

    publish()
  }

  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot(): PwaSnapshot {
      return snapshot
    },
    async promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
      if (!deferred) {
        return "unavailable"
      }

      const event = deferred

      deferred = null
      publish()
      await event.prompt()

      return (await event.userChoice).outcome
    },
    /** On iOS, "I've added it": the app cannot detect the install, so it only hides the card. */
    markInstalled(): void {
      remember()
    },
    dismissInstall(): void {
      remember()
    },
    setUpdateReady(apply: () => Promise<void>): void {
      applyFn = apply
      publish()
    },
    async applyUpdate(): Promise<void> {
      await applyFn?.()
    },
  }
}

function browserStore(): ReturnType<typeof createPwaStore> {
  if (typeof window === "undefined") {
    throw new Error("pwaStore is browser-only")
  }

  let storage: Storage | null = null

  try {
    storage = window.localStorage
  } catch {
    storage = null
  }

  return createPwaStore({ win: window, storage })
}

export const pwaStore: ReturnType<typeof createPwaStore> = browserStore()
