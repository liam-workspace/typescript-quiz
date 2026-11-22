import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { StrictMode, type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  useWaitingRecheck,
  type WaitingData,
} from "../src/lib/attempt/use-waiting-recheck.js"
import type { SyncStatusSnapshot } from "../src/lib/attempt/sync-status.js"

interface Data extends WaitingData {
  readonly id: string
}

const waitingData: Data = { id: "waiting", waiting: true }
const readyData: Data = { id: "ready" }
const status = (
  over: Partial<SyncStatusSnapshot> = {},
): SyncStatusSnapshot => ({
  syncing: false,
  pendingAttempts: 1,
  pendingEvents: 3,
  failedAttemptIds: [],
  ...over,
})

interface Props {
  status: SyncStatusSnapshot
  online?: boolean
  load: (id: string) => Promise<Data>
  data?: Data
}

function setup(initial: Props, strict = false) {
  const wrapper = strict
    ? ({ children }: { children: ReactNode }) => (
        <StrictMode>{children}</StrictMode>
      )
    : undefined

  return renderHook(
    (p: Props) =>
      useWaitingRecheck({
        attemptId: "att-1",
        data: p.data ?? waitingData,
        status: p.status,
        online: p.online ?? true,
        load: p.load,
      }),
    { initialProps: initial, wrapper },
  )
}

const flush = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      }),
  )

afterEach(cleanup)

describe("useWaitingRecheck", () => {
  it("swaps to the real data once the sync finishes, without a reload", async () => {
    const load = vi.fn().mockResolvedValue(readyData)
    const { result, rerender } = setup({
      status: status({ syncing: true }),
      load,
    })

    await flush()
    expect(load).not.toHaveBeenCalled()
    expect(result.current.data).toBe(waitingData)

    rerender({ status: status({ syncing: false, pendingAttempts: 0 }), load })

    await waitFor(() => expect(result.current.data).toBe(readyData))
    expect(load).toHaveBeenCalledOnce()
  })

  it("does not loop when the re-check still reports waiting", async () => {
    const load = vi.fn().mockResolvedValue({ ...waitingData })
    const same = status()
    const { rerender } = setup({ status: same, load })

    await flush()
    await flush()
    rerender({ status: same, load })
    await flush()
    expect(load).toHaveBeenCalledTimes(1)

    rerender({ status: status({ pendingEvents: 2 }), load })
    await flush()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("never re-checks while syncing, after a refusal, or offline", async () => {
    const load = vi.fn().mockResolvedValue(readyData)
    const { rerender } = setup({ status: status({ syncing: true }), load })

    rerender({ status: status({ failedAttemptIds: ["att-1"] }), load })
    rerender({ status: status({ pendingEvents: 9 }), online: false, load })
    await flush()

    expect(load).not.toHaveBeenCalled()
  })

  it("reports a refused journal for this attempt", () => {
    const { result } = setup({
      status: status({ failedAttemptIds: ["att-1"] }),
      load: vi.fn(),
    })

    expect(result.current.syncFailed).toBe(true)
  })

  it("is safe under StrictMode's double effect and overlapping checks", async () => {
    let resolve: (d: Data) => void = () => undefined
    const load = vi.fn(
      () =>
        new Promise<Data>((r) => {
          resolve = r
        }),
    )
    const { result } = setup({ status: status(), load }, true)

    await flush()
    act(() => {
      result.current.checkAgain()
      result.current.checkAgain()
    })
    expect(load).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolve(readyData)
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.data).toBe(readyData))
  })

  it("a failed re-check with nothing pending is a retryable failure, not a dead end", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("no result"))
      .mockResolvedValue(readyData)
    const { result } = setup({
      status: status({ pendingAttempts: 0, pendingEvents: 0 }),
      load,
    })

    await waitFor(() => expect(result.current.checkFailed).toBe(true))
    expect(result.current.data).toBe(waitingData)

    act(() => {
      result.current.checkAgain()
    })

    await waitFor(() => expect(result.current.data).toBe(readyData))
    expect(result.current.checkFailed).toBe(false)
  })

  it("a failed re-check while work is still pending keeps the waiting state quietly", async () => {
    const load = vi.fn().mockRejectedValue(new Error("offline"))
    const { result } = setup({ status: status(), load })

    await flush()
    expect(load).toHaveBeenCalled()
    expect(result.current.checkFailed).toBe(false)
  })
})
