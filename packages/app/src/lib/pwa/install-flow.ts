import { pwaStore, type PwaSnapshot } from "./pwa-store.js"

export type InstallStep = "accepted" | "dismissed" | "show-ios" | "show-manual"

interface InstallSource {
  getSnapshot(): PwaSnapshot
  promptInstall(): Promise<"accepted" | "dismissed" | "unavailable">
}

/**
 * What "Install" does on this browser (spec D2). The prototype's Android
 * sheet only simulated Chrome's own prompt, so on Chromium this calls the
 * real one; iOS has none and needs the Share-menu steps.
 */
export async function startInstall(
  source: InstallSource = pwaStore,
): Promise<InstallStep> {
  const snapshot = source.getSnapshot()

  if (snapshot.canPromptInstall) {
    const outcome = await source.promptInstall()

    if (outcome === "accepted" || outcome === "dismissed") {
      return outcome
    }
  }

  return snapshot.platform === "ios" ? "show-ios" : "show-manual"
}
