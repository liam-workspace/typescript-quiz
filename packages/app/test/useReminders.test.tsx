import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "../src/i18n.js"
import {
  ReminderError,
  type RemindersApi,
  type ReminderState,
} from "../src/lib/reminders.js"
import { toastStore } from "../src/lib/toast.js"
import { useReminders } from "../src/lib/useReminders.js"

function slowState(): Promise<ReminderState> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("off")
    }, 20)
  })
}

function fakeApi(initial: ReminderState) {
  return {
    state: vi.fn<RemindersApi["state"]>().mockResolvedValue(initial),
    enable: vi.fn<RemindersApi["enable"]>().mockResolvedValue("on"),
    disable: vi.fn<RemindersApi["disable"]>().mockResolvedValue("off"),
  } satisfies RemindersApi
}

async function mounted(api: RemindersApi, expected: ReminderState) {
  const hook = renderHook(() => useReminders(api))

  await waitFor(() => {
    expect(hook.result.current.state).toBe(expected)
  })

  return hook
}

describe("useReminders", () => {
  const toast = vi.fn<typeof toastStore.show>()

  beforeEach(() => {
    vi.spyOn(toastStore, "show").mockImplementation(toast)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    toast.mockReset()
  })

  it("loads the real state on mount", async () => {
    const api = fakeApi("on")

    await mounted(api, "on")
    expect(api.state).toHaveBeenCalled()
  })

  it("re-reads the state when the page becomes visible again", async () => {
    const api = fakeApi("off")
    const { result } = await mounted(api, "off")

    api.state.mockResolvedValue("denied")
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })

    await waitFor(() => {
      expect(result.current.state).toBe("denied")
    })
  })

  it("turning the switch on opens the permission sheet and does NOT ask the browser yet", async () => {
    const api = fakeApi("off")
    const { result } = await mounted(api, "off")

    act(() => {
      result.current.toggle(true)
    })

    expect(result.current.sheetOpen).toBe(true)
    expect(api.enable).not.toHaveBeenCalled()
  })

  it("Allow enables, closes the sheet, flips to on and toasts 'Reminders turned on.'", async () => {
    const api = fakeApi("off")
    const { result } = await mounted(api, "off")

    act(() => {
      result.current.toggle(true)
    })
    await act(() => result.current.allow())

    expect(api.enable).toHaveBeenCalledOnce()
    expect(result.current.state).toBe("on")
    expect(result.current.sheetOpen).toBe(false)
    expect(result.current.busy).toBe(false)
    expect(toast).toHaveBeenCalledWith("Reminders turned on.", "bell")
  })

  it("a refusal at the browser prompt shows 'Reminders blocked.' and the denied row", async () => {
    const api = fakeApi("off")
    api.enable.mockResolvedValue("denied")
    const { result } = await mounted(api, "off")

    act(() => {
      result.current.toggle(true)
    })
    await act(() => result.current.allow())

    expect(result.current.state).toBe("denied")
    expect(toast).toHaveBeenCalledWith("Reminders blocked.", "bell")
  })

  it("dismissing the browser prompt leaves it off with no toast", async () => {
    const api = fakeApi("off")
    api.enable.mockResolvedValue("off")
    const { result } = await mounted(api, "off")

    act(() => {
      result.current.toggle(true)
    })
    await act(() => result.current.allow())

    expect(result.current.state).toBe("off")
    expect(result.current.sheetOpen).toBe(false)
    expect(toast).not.toHaveBeenCalled()
  })

  it.each([
    ["not-configured", "not-configured"],
    ["offline", "offline"],
    ["conflict", "conflict"],
    ["failed", "failed"],
  ] as const)(
    "a %s failure closes the sheet, re-reads the real state and names the reason",
    async (reason, problem) => {
      const api = fakeApi("off")
      api.enable.mockRejectedValue(new ReminderError(reason))
      const { result } = await mounted(api, "off")

      act(() => {
        result.current.toggle(true)
      })
      api.state.mockClear()
      await act(() => result.current.allow())

      expect(result.current.problem).toBe(problem)
      expect(result.current.state).toBe("off")
      expect(result.current.sheetOpen).toBe(false)
      expect(result.current.busy).toBe(false)
      expect(api.state).toHaveBeenCalled()
      expect(toast).not.toHaveBeenCalled()
    },
  )

  it.each([
    ["succeeds", null],
    ["fails", new ReminderError("offline")],
  ] as const)(
    "when a turn-on %s, the sheet never closes while the switch is still busy (focus could not return to a disabled switch)",
    async (_name, error) => {
      const api = fakeApi("off")

      if (error) {
        api.enable.mockRejectedValue(error)
      }

      const seen: Array<{ sheetOpen: boolean; busy: boolean }> = []
      const hook = renderHook(() => {
        const result = useReminders(api)

        seen.push({ sheetOpen: result.sheetOpen, busy: result.busy })

        return result
      })

      await waitFor(() => {
        expect(api.state).toHaveBeenCalled()
      })
      act(() => {
        hook.result.current.toggle(true)
      })
      seen.length = 0
      // Outside act(), so React commits as a browser would: each await in
      // allow() can land its own commit. The re-read after a failure takes
      // real time, as a real api.state() does.
      api.state.mockImplementation(slowState)
      const reactActEnvironment = globalThis as {
        IS_REACT_ACT_ENVIRONMENT?: boolean
      }
      reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false

      try {
        await hook.result.current.allow()
        await new Promise((resolve) => {
          setTimeout(resolve, 30)
        })
      } finally {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
      }

      expect(seen.at(-1)).toEqual({ sheetOpen: false, busy: false })
      expect(seen.filter((render) => !render.sheetOpen && render.busy)).toEqual(
        [],
      )
    },
  )

  it("an unexpected (non-ReminderError) rejection is a generic failure, never unhandled", async () => {
    const api = fakeApi("off")
    api.enable.mockRejectedValue(new Error("boom"))
    const { result } = await mounted(api, "off")

    await act(() => result.current.allow())

    expect(result.current.problem).toBe("failed")
  })

  it("the server refusing this browser's push service reads as unsupported, with a toast", async () => {
    const api = fakeApi("off")
    api.enable.mockRejectedValue(new ReminderError("browser-refused"))
    const { result } = await mounted(api, "off")

    api.state.mockResolvedValue("unsupported")
    await act(() => result.current.allow())

    expect(result.current.state).toBe("unsupported")
    expect(result.current.problem).toBeNull()
    expect(toast).toHaveBeenCalledWith(
      "This browser can't send reminders.",
      "bell",
    )
  })

  it("a new attempt clears the previous failure", async () => {
    const api = fakeApi("off")
    api.enable.mockRejectedValueOnce(new ReminderError("offline"))
    const { result } = await mounted(api, "off")

    await act(() => result.current.allow())
    expect(result.current.problem).toBe("offline")

    act(() => {
      result.current.toggle(true)
    })
    expect(result.current.problem).toBeNull()
  })

  it("Don't allow just closes the sheet — it never marks reminders blocked and never toasts", async () => {
    const api = fakeApi("off")
    const { result } = await mounted(api, "off")

    act(() => {
      result.current.toggle(true)
    })
    act(() => {
      result.current.decline()
    })

    expect(result.current.sheetOpen).toBe(false)
    expect(result.current.state).toBe("off")
    expect(api.enable).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it("turning it off disables and toasts 'Reminders turned off.'", async () => {
    const api = fakeApi("on")
    const { result } = await mounted(api, "on")

    act(() => {
      result.current.toggle(false)
    })

    await waitFor(() => {
      expect(result.current.state).toBe("off")
    })
    await waitFor(() => {
      expect(result.current.busy).toBe(false)
    })
    expect(api.disable).toHaveBeenCalledOnce()
    expect(toast).toHaveBeenCalledWith("Reminders turned off.", "bell")
  })

  it("a turn-off the browser did not honour stays on and says so", async () => {
    const api = fakeApi("on")
    api.disable.mockResolvedValue("on")
    const { result } = await mounted(api, "on")

    act(() => {
      result.current.toggle(false)
    })

    await waitFor(() => {
      expect(result.current.problem).toBe("disable")
    })
    expect(result.current.state).toBe("on")
    expect(toast).not.toHaveBeenCalled()
  })

  it("a rejected turn-off re-reads the real state and says so", async () => {
    const api = fakeApi("on")
    api.disable.mockRejectedValue(new Error("boom"))
    const { result } = await mounted(api, "on")

    act(() => {
      result.current.toggle(false)
    })

    await waitFor(() => {
      expect(result.current.problem).toBe("disable")
    })
    expect(result.current.state).toBe("on")
    expect(result.current.busy).toBe(false)
  })

  it("a refresh that started before a change cannot overwrite its outcome", async () => {
    const api = fakeApi("off")
    const { result } = await mounted(api, "off")
    let answerStale: (state: ReminderState) => void = () => undefined

    api.state.mockReturnValueOnce(
      new Promise((resolve) => {
        answerStale = resolve
      }),
    )
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await act(() => result.current.allow())
    expect(result.current.state).toBe("on")

    await act(async () => {
      answerStale("off")
      await Promise.resolve()
    })

    expect(result.current.state).toBe("on")
  })

  it.each(["denied", "needs-install", "unsupported"] as const)(
    "does nothing when toggled while the state is %s",
    async (state) => {
      const api = fakeApi(state)
      const { result } = await mounted(api, state)

      act(() => {
        result.current.toggle(true)
      })
      act(() => {
        result.current.toggle(false)
      })

      expect(result.current.sheetOpen).toBe(false)
      expect(api.enable).not.toHaveBeenCalled()
      expect(api.disable).not.toHaveBeenCalled()
    },
  )
})
