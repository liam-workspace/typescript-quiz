import "fake-indexeddb/auto"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { AnswerQueue } from "../lib/answerQueue.js"
import {
  OfflineError,
  type AttemptGateway,
} from "../lib/attempt/attempt-gateway.js"
import { JournalStore } from "../lib/attempt/journal-store.js"
import { LocalAttemptGateway } from "../lib/attempt/local-gateway.js"
import { makeBundle } from "../../test/helpers/bundle-fixture.js"
import { makeEnvelope } from "../../test/helpers/envelope-fixture.js"
import { makeLocalState } from "../../test/helpers/local-state-fixture.js"
import { RunScreen } from "./attempts.$attemptId.run.js"

const queues: AnswerQueue[] = []
let n = 0

async function openQueue(): Promise<AnswerQueue> {
  n += 1
  const queue = await AnswerQueue.open(`pp-run-offline-${n}`)

  queues.push(queue)

  return queue
}

afterEach(async () => {
  cleanup()
  await Promise.all(queues.splice(0).map((queue) => queue.close()))
})

const claimPlay = vi.fn<AttemptGateway["claimPlay"]>()

function gatewayThatCannotPlay(): AttemptGateway {
  claimPlay.mockReset().mockRejectedValue(new OfflineError("media_missing"))

  return {
    start: vi.fn(),
    loadEnvelope: vi.fn(),
    enterSection: vi.fn(),
    setPosition: vi.fn().mockResolvedValue(undefined),
    claimPlay,
    finishSection: vi.fn(),
    submit: vi.fn(),
    noteAnswer: vi.fn().mockResolvedValue(undefined),
    flushAnswers: vi.fn().mockResolvedValue({
      flushed: true,
      rejectedQuestionIds: [],
      saveState: { status: "saved", pendingCount: 0 },
      outcome: "success",
    }),
    isLocalOnly: vi.fn().mockResolvedValue(true),
  }
}

describe("RunScreen offline", () => {
  it("shows the recording-did-not-load state, not a crash, when the audio is not on the phone", async () => {
    const user = userEvent.setup()
    const gateway = gatewayThatCannotPlay()

    render(
      <RunScreen
        attemptId="att-1"
        envelope={makeEnvelope()}
        queue={await openQueue()}
        navigate={vi.fn()}
        gateway={gateway}
        localOnly
      />,
    )
    await user.click(
      await screen.findByRole("button", { name: /play recording/iu }),
    )

    expect(await screen.findByText(/recording didn't load/iu)).toBeVisible()
    expect(claimPlay).toHaveBeenCalledWith("att-1", "st-l")
  })

  it("a tapped answer is journaled BEFORE the finish_section that follows it (local gateway)", async () => {
    const user = userEvent.setup()
    const journal = await JournalStore.open(`pp-run-offline-journal-${n}`)
    const bundle = makeBundle()
    const now = Date.now()
    // Reading first, then listening: reading's Finish leads somewhere.
    const sections = [...makeLocalState().sections].reverse()
    const local = new LocalAttemptGateway({
      journal,
      clock: { nowMs: () => Date.now() },
      bundles: {
        list: () => Promise.resolve([]),
        getBundle: () => Promise.resolve(bundle),
        getMediaBlob: () => Promise.resolve(null),
      },
      newId: () => "att-1",
      objectUrl: () => "blob:x",
      requestSync: () => undefined,
      ownerSub: () => "sub-1",
    })

    await journal.putAttempt(
      makeLocalState({
        sections: sections.map((s) =>
          s.id === "sec-r"
            ? {
                ...s,
                status: "open" as const,
                expiresAt: new Date(now + 600_000).toISOString(),
              }
            : s,
        ),
        currentSectionId: "sec-r",
        currentQuestionId: "q-r1",
        attemptStartedAt: new Date(now).toISOString(),
        attemptExpiresAt: new Date(now + 1_200_000).toISOString(),
      }),
    )

    // A journal write that is slow (a busy phone) -- slower than the
    // AnswerQueue write the finish used to wait for.
    const gateway: AttemptGateway = {
      start: (slug, hint) => local.start(slug, hint),
      loadEnvelope: (id) => local.loadEnvelope(id),
      enterSection: (id, s) => local.enterSection(id, s),
      setPosition: (id, s, q) => local.setPosition(id, s, q),
      claimPlay: (id, s) => local.claimPlay(id, s),
      finishSection: (id, s, body) => local.finishSection(id, s, body),
      submit: (id, body) => local.submit(id, body),
      noteAnswer: async (id, answer) => {
        await new Promise((resolve) => {
          setTimeout(resolve, 150)
        })
        await local.noteAnswer(id, answer)
      },
      flushAnswers: (ctx) => local.flushAnswers(ctx),
      isLocalOnly: (id) => local.isLocalOnly(id),
    }
    const navigate = vi.fn()

    render(
      <RunScreen
        attemptId="att-1"
        envelope={await local.loadEnvelope("att-1")}
        queue={await openQueue()}
        navigate={navigate}
        gateway={gateway}
        localOnly
      />,
    )

    await user.click(await screen.findByRole("radio", { name: /a garden/iu }))
    await user.click(screen.getByRole("button", { name: "Finish Reading" }))
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Finish Reading",
      }),
    )

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(
        "/attempts/att-1/sections/sec-l/rules",
      )
    })

    const events = await journal.eventsAfter("att-1", 0)

    expect(events.map((e) => [e.type, e.payload.questionId])).toEqual([
      ["answer", "q-r1"],
      ["finish_section", undefined],
    ])
  })
})
