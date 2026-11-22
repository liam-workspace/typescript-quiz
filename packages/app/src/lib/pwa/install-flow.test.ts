import { describe, expect, it, vi } from "vitest"
import type { PwaSnapshot } from "./pwa-store.js"
import { startInstall } from "./install-flow.js"

function store(
  snapshot: Partial<PwaSnapshot>,
  outcome: "accepted" | "dismissed" | "unavailable" = "accepted",
) {
  return {
    getSnapshot: () =>
      ({
        standalone: false,
        canPromptInstall: false,
        platform: "other",
        installDismissed: false,
        updateReady: false,
        ...snapshot,
      }) as PwaSnapshot,
    promptInstall: vi.fn(() => Promise.resolve(outcome)),
  }
}

describe("startInstall", () => {
  it("uses the browser's own prompt when it is available", async () => {
    const s = store(
      { canPromptInstall: true, platform: "android" },
      "dismissed",
    )

    await expect(startInstall(s)).resolves.toBe("dismissed")
    expect(s.promptInstall).toHaveBeenCalledTimes(1)
  })

  it("falls back to the manual sheet when the browser's prompt is unavailable after all (D12)", async () => {
    const s = store(
      { canPromptInstall: true, platform: "android" },
      "unavailable",
    )

    await expect(startInstall(s)).resolves.toBe("show-manual")
  })

  it("shows the Share-menu steps on iOS Safari (no prompt exists)", async () => {
    const s = store({ platform: "ios" })

    await expect(startInstall(s)).resolves.toBe("show-ios")
    expect(s.promptInstall).not.toHaveBeenCalled()
  })

  it("shows manual steps when a Chromium browser has no prompt to offer (already used or unsupported)", async () => {
    await expect(startInstall(store({ platform: "android" }))).resolves.toBe(
      "show-manual",
    )
    await expect(startInstall(store({ platform: "other" }))).resolves.toBe(
      "show-manual",
    )
  })

  it("falls back to manual steps if the captured prompt turns out to be gone", async () => {
    await expect(
      startInstall(
        store({ canPromptInstall: true, platform: "android" }, "unavailable"),
      ),
    ).resolves.toBe("show-manual")
  })
})
