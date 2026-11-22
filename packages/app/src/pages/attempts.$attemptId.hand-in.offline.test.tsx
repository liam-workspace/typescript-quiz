import "fake-indexeddb/auto"
import "../i18n.js"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { networkStore } from "../lib/network.js"
import { AnswerQueue } from "../lib/answerQueue.js"
import {
  OfflineError,
  type AttemptGateway,
} from "../lib/attempt/attempt-gateway.js"
import { makeEnvelope } from "../../test/helpers/envelope-fixture.js"
import { HandInScreen } from "./attempts.$attemptId.hand-in.js"

function gateway(submit: AttemptGateway["submit"]): AttemptGateway {
  return {
    start: vi.fn(),
    loadEnvelope: vi.fn(),
    enterSection: vi.fn(),
    setPosition: vi.fn(),
    claimPlay: vi.fn(),
    finishSection: vi.fn(),
    submit,
    noteAnswer: vi.fn(),
    flushAnswers: vi.fn(),
    isLocalOnly: vi.fn().mockResolvedValue(false),
    hasPendingJournal: vi.fn().mockResolvedValue(false),
  }
}

let n = 0
const openQueue = () => {
  n += 1

  return AnswerQueue.open(`pp-handin-offline-${n}`)
}

async function renderHandIn(submit: AttemptGateway["submit"]) {
  const navigate = vi.fn()

  render(
    <HandInScreen
      attemptId="att-1"
      envelope={makeEnvelope("reading")}
      queue={await openQueue()}
      navigate={navigate}
      gateway={gateway(submit)}
    />,
  )

  return navigate
}

describe("HandInScreen submit without a connection", () => {
  afterEach(() => {
    cleanup()
  })

  it("a submit the gateway refuses as offline shows the reason, stays retryable and does not crash", async () => {
    const submit = vi.fn().mockRejectedValue(new OfflineError("offline"))
    const navigate = await renderHandIn(submit)

    fireEvent.click(screen.getByRole("button", { name: "Hand in" }))

    const reason = await screen.findByRole("alert")

    expect(reason).toHaveTextContent(/needs a connection/i)
    expect(screen.getByRole("button", { name: "Hand in" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Hand in" })).toHaveAttribute(
      "aria-describedby",
      reason.id,
    )
    expect(navigate).not.toHaveBeenCalled()
  })

  it("the offline reason clears when connectivity returns", async () => {
    const submit = vi.fn().mockRejectedValue(new OfflineError("offline"))

    await renderHandIn(submit)
    fireEvent.click(screen.getByRole("button", { name: "Hand in" }))
    await screen.findByRole("alert")

    act(() => {
      networkStore.setOnlineForTests(false)
    })
    act(() => {
      networkStore.setOnlineForTests(true)
    })

    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("button", { name: "Hand in" })).not.toHaveAttribute(
      "aria-describedby",
    )
  })

  it("a refused journal says some answers could not be sent, not a generic error", async () => {
    const submit = vi.fn().mockRejectedValue(new OfflineError("sync_failed"))

    await renderHandIn(submit)
    fireEvent.click(screen.getByRole("button", { name: "Hand in" }))

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Some answers couldn't be sent. Please tell an adult.",
      ),
    )
    expect(screen.queryByText(/something went wrong/i)).toBeNull()
  })

  it("a successful submit goes to the result", async () => {
    const submit = vi.fn().mockResolvedValue({
      attemptId: "att-1",
      status: "submitted",
      submittedAt: "2026-11-22T11:00:00.000Z",
      resultUrl: "/attempts/att-1/result",
      finalFlush: [],
    })
    const navigate = await renderHandIn(submit)

    fireEvent.click(screen.getByRole("button", { name: "Hand in" }))

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/attempts/att-1/result"),
    )
  })
})
