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
import { ApiError } from "../lib/api-client.js"
import type { RunnerEnvelope } from "../lib/api-types.js"
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
    hasPendingJournal: vi.fn().mockResolvedValue(true),
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
      hasPendingJournal: (id) => local.hasPendingJournal(id),
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

  it("an answer the rules refuse shows the didn't-save notice, is never resent, and does not block Finish", async () => {
    const user = userEvent.setup()
    const queue = await openQueue()
    const finishSection = vi.fn<AttemptGateway["finishSection"]>()
    const base = gatewayThatCannotPlay()
    const gateway: AttemptGateway = {
      ...base,
      noteAnswer: () =>
        Promise.reject(
          new ApiError({ type: "navigation_locked", title: "x", status: 409 }),
        ),
      finishSection,
    }
    const envelope = makeEnvelope("reading")
    const navigate = vi.fn()

    finishSection.mockResolvedValue({
      sectionId: "sec-r",
      status: "finished",
      nextSectionId: "sec-x",
      finalFlush: [],
    })
    // Reading followed by another section, so it has a Finish button.
    envelope.sections = [
      ...envelope.sections.filter((s) => s.id === "sec-r"),
      { ...envelope.sections[0], id: "sec-x", status: "pending" as const },
    ]

    render(
      <RunScreen
        attemptId="att-1"
        envelope={envelope}
        queue={queue}
        navigate={navigate}
        gateway={gateway}
        localOnly
      />,
    )
    await user.click(await screen.findByRole("radio", { name: /a garden/iu }))

    expect(await screen.findByText(/This answer didn't save/u)).toBeVisible()
    await waitFor(async () => {
      expect(await queue.terminalRejectionsForAttempt("att-1")).toEqual([
        "q-r1",
      ])
    })

    await user.click(screen.getByRole("button", { name: "Finish Reading" }))
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Finish Reading",
      }),
    )

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(
        "/attempts/att-1/sections/sec-x/rules",
      )
    })
  })
})

/**
 * A1: a local gateway whose `noteAnswer` is slow (a busy phone: the answer
 * takes ~5 IndexedDB hops to reach the journal, a position ~3). `noted`
 * flips once the answer really is journaled.
 */
async function slowNoteRig(
  state: Parameters<typeof makeLocalState>[0],
): Promise<{
  journal: JournalStore
  local: LocalAttemptGateway
  gateway: AttemptGateway
  noted: { v: boolean }
}> {
  const journal = await JournalStore.open(
    `pp-run-offline-a1-${n}-${Date.now()}`,
  )
  const bundle = makeBundle()
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
  const noted = { v: false }

  await journal.putAttempt(makeLocalState(state))

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
      noted.v = true
    },
    flushAnswers: (ctx) => local.flushAnswers(ctx),
    isLocalOnly: (id) => local.isLocalOnly(id),
    hasPendingJournal: (id) => local.hasPendingJournal(id),
  }

  return { journal, local, gateway, noted }
}

const journalOrder = async (
  journal: JournalStore,
): Promise<Array<[string, unknown]>> =>
  (await journal.eventsAfter("att-1", 0)).map((e) => [
    e.type,
    e.payload.questionId,
  ])

/** Forward-only listening open on q-l1, the recording already heard. */
function listeningOpen(): Parameters<typeof makeLocalState>[0] {
  const now = Date.now()

  return {
    sections: makeLocalState().sections.map((s) =>
      s.id === "sec-l"
        ? {
            ...s,
            status: "open" as const,
            expiresAt: new Date(now + 600_000).toISOString(),
          }
        : s,
    ),
    currentSectionId: "sec-l",
    currentQuestionId: "q-l1",
    playsUsed: { "st-l": 1 },
    attemptStartedAt: new Date(now).toISOString(),
    attemptExpiresAt: new Date(now + 1_200_000).toISOString(),
  }
}

describe("RunScreen offline — moves wait for the answer just tapped (A1)", () => {
  it("tap an answer then Next at once: the journal holds the answer BEFORE the position, and the answer is applied", async () => {
    const user = userEvent.setup()
    const { journal, local, gateway } = await slowNoteRig(listeningOpen())

    render(
      <RunScreen
        attemptId="att-1"
        envelope={await local.loadEnvelope("att-1")}
        queue={await openQueue()}
        navigate={vi.fn()}
        gateway={gateway}
        localOnly
      />,
    )

    await user.click(await screen.findByRole("radio", { name: /bench/iu }))
    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(
      await screen.findByRole("heading", { name: /what time is it/iu }),
    ).toBeVisible()
    await waitFor(async () => {
      expect(await journalOrder(journal)).toEqual([
        ["answer", "q-l1"],
        ["position", "q-l2"],
      ])
    })
    expect(
      (await journal.getAttempt("att-1"))?.responses?.map((r) => r.questionId),
    ).toEqual(["q-l1"])
    expect(screen.queryByText(/This answer didn't save/u)).toBeNull()
  })

  it("Leave waits for the answer just tapped to reach the journal before navigating away", async () => {
    const user = userEvent.setup()
    const { local, gateway, noted } = await slowNoteRig(listeningOpen())
    const notedAtNavigate: boolean[] = []
    const navigate = vi.fn(() => {
      notedAtNavigate.push(noted.v)
    })

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

    await user.click(await screen.findByRole("radio", { name: /bench/iu }))
    await user.click(screen.getByRole("button", { name: "Open menu" }))
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Leave test",
      }),
    )

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/")
    })
    expect(notedAtNavigate).toEqual([true])
  })

  it("Hand in waits for the answer just tapped to reach the journal before navigating", async () => {
    const user = userEvent.setup()
    const now = Date.now()
    const { local, gateway, noted } = await slowNoteRig({
      sections: makeLocalState().sections.map((s) =>
        s.id === "sec-r"
          ? {
              ...s,
              status: "open" as const,
              expiresAt: new Date(now + 600_000).toISOString(),
            }
          : { ...s, status: "closed" as const },
      ),
      currentSectionId: "sec-r",
      currentQuestionId: "q-r1",
      attemptStartedAt: new Date(now).toISOString(),
      attemptExpiresAt: new Date(now + 1_200_000).toISOString(),
    })
    const notedAtNavigate: boolean[] = []
    const navigate = vi.fn(() => {
      notedAtNavigate.push(noted.v)
    })

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
    await user.click(screen.getByRole("button", { name: "Hand in" }))

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/attempts/att-1/hand-in")
    })
    expect(notedAtNavigate).toEqual([true])
  })
})

/** The listening section with its recording already played once. */
function heardListening(
  section: RunnerEnvelope["sections"][number],
): RunnerEnvelope["sections"][number] {
  return section.id === "sec-l"
    ? {
        ...section,
        groups: section.groups.map((g) => ({
          ...g,
          stimulus: g.stimulus ? { ...g.stimulus, playsUsed: 1 } : g.stimulus,
        })),
      }
    : section
}

describe("RunScreen — storage-write failures are never silent (A9)", () => {
  const quota = (): DOMException =>
    new DOMException("The quota has been exceeded.", "QuotaExceededError")

  it("an answer whose journal write fails (QuotaExceededError) shows the didn't-save notice", async () => {
    const user = userEvent.setup()
    const gateway: AttemptGateway = {
      ...gatewayThatCannotPlay(),
      noteAnswer: () => Promise.reject(quota()),
    }

    render(
      <RunScreen
        attemptId="att-1"
        envelope={makeEnvelope("reading")}
        queue={await openQueue()}
        navigate={vi.fn()}
        gateway={gateway}
        localOnly
      />,
    )
    await user.click(await screen.findByRole("radio", { name: /a garden/iu }))

    expect(await screen.findByText(/This answer didn't save/u)).toBeVisible()
  })

  it("a move whose journal write fails shows the notice instead of an unhandled rejection, and stays put", async () => {
    const user = userEvent.setup()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }

    process.on("unhandledRejection", onUnhandled)

    try {
      const envelope = makeEnvelope()

      envelope.sections = envelope.sections.map(heardListening)

      const gateway: AttemptGateway = {
        ...gatewayThatCannotPlay(),
        setPosition: () => Promise.reject(quota()),
      }

      render(
        <RunScreen
          attemptId="att-1"
          envelope={envelope}
          queue={await openQueue()}
          navigate={vi.fn()}
          gateway={gateway}
          localOnly
        />,
      )
      await user.click(screen.getByRole("button", { name: "Next" }))

      expect(await screen.findByText(/This answer didn't save/u)).toBeVisible()
      expect(
        screen.getByRole("heading", { name: /where is the bag/iu }),
      ).toBeVisible()
      await new Promise((resolve) => {
        setTimeout(resolve, 20)
      })
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })
})
