import "fake-indexeddb/auto"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { isRedirect } from "@tanstack/react-router"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest"
import "../i18n.js"
import { ApiError } from "../lib/api-client.js"
import { AnswerQueue } from "../lib/answerQueue.js"
import type { Scheduler } from "../lib/flushController.js"
import {
  claimPlay,
  finishSection,
  getRunnerEnvelope,
  setPosition,
} from "../lib/attempts-api.js"
import type {
  CappedStimulusWire,
  FinishSectionRequest,
  FinishSectionResult,
  ResponseSnapshotItem,
  RunnerEnvelope,
} from "../lib/api-types.js"
import { getCurrentStudent } from "../lib/session-api.js"
import {
  loadRunRouteData,
  loadRunScreenData,
  RunRouteError,
  RunScreen,
} from "./attempts.$attemptId.run.js"

const DB_NAME = "pp-answer-queue-run-test"

// Top-level, not inline: a named function passed by reference (rather than
// an arrow written at the call site) adds no callback-nesting depth at the
// describe/beforeEach/it it is used from -- see `loadRunRouteData /
// RunRouteError`'s `beforeEach`, which is already three levels deep before
// this is even involved.
function closeQueue(queue: AnswerQueue): Promise<void> {
  return queue.close()
}

// `loadRunRouteData("attempt-1").catch(...)` below needs the rejection
// VALUE, not to re-throw it -- `(error: unknown) => error` inline would be
// a fourth nested callback at that call site.
function asRejectionValue(error: unknown): unknown {
  return error
}

/**
 * `loadRunRouteData` opens a REAL AnswerQueue (fake-indexeddb-backed,
 * default DB name -- distinct from this file's own `DB_NAME`) alongside the
 * envelope fetch, per its own doc comment, even when the envelope half
 * rejects and the queue is never handed back to the caller to close. Left
 * open, that connection is exactly the kind of dangling handle that made
 * fake-indexeddb's shared, cross-file job queue flaky for unrelated later
 * tests. This wraps `AnswerQueue.open` to capture every instance it mints
 * into `sink`, so the describe block's own `afterEach` can close them --
 * fixing the test's hygiene rather than changing `loadRunRouteData`'s
 * production behaviour just to suit it.
 */
function trackingOpener(
  original: (name?: string) => Promise<AnswerQueue>,
  sink: AnswerQueue[],
): (name?: string) => Promise<AnswerQueue> {
  return async function tracked(name?: string): Promise<AnswerQueue> {
    const opened = await original(name)

    sink.push(opened)

    return opened
  }
}

vi.mock("../lib/attempts-api.js", () => ({
  claimPlay: vi.fn(),
  finishSection: vi.fn(),
  setPosition: vi.fn(),
  getRunnerEnvelope: vi.fn(),
}))

vi.mock("../lib/session-api.js", () => ({
  getCurrentStudent: vi.fn(),
}))

const mockClaimPlay = vi.mocked(claimPlay)
const mockFinishSection = vi.mocked(finishSection)
const mockGetCurrentStudent = vi.mocked(getCurrentStudent)
const mockGetRunnerEnvelope = vi.mocked(getRunnerEnvelope)
const mockSetPosition = vi.mocked(setPosition)

/**
 * Hoisted rather than inlined into `waitFor`: this assertion lives two
 * describes deep, and an inline arrow there is a fourth nested callback.
 */
const fetchWasCalled = (): void => {
  expect(fetch).toHaveBeenCalled()
}

/**
 * Hoisted rather than inlined into `waitFor`: this assertion lives two
 * describes deep, and an inline arrow there is a fourth nested callback.
 */
const positionWasWritten = (): void => {
  expect(mockSetPosition).toHaveBeenCalledOnce()
}

const finishWasCalled = (): void => {
  expect(mockFinishSection).toHaveBeenCalledOnce()
}

class TestClock {
  public reads = 0
  private currentMs: number

  public constructor(initialMs: number) {
    this.currentMs = initialMs
  }

  public read(): number {
    this.reads += 1

    return this.currentMs
  }

  public advance(ms: number): void {
    this.currentMs += ms
  }
}

function advanceClock(clock: TestClock, ms: number): void {
  act(() => {
    clock.advance(ms)
    vi.advanceTimersByTime(ms)
  })
}

async function advanceClockAndFlush(
  clock: TestClock,
  ms: number,
): Promise<void> {
  await act(async () => {
    clock.advance(ms)
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
  })
}

function toAppliedFinishItem(item: ResponseSnapshotItem) {
  return { questionId: item.questionId, status: "applied" as const }
}

function finishWithAppliedRemainder(
  _attemptId: string,
  sectionId: string,
  body: FinishSectionRequest,
): Promise<FinishSectionResult> {
  return Promise.resolve({
    sectionId,
    status: "finished",
    nextSectionId: "section-reading",
    finalFlush: (body.responses ?? []).map(toAppliedFinishItem),
  })
}

function resolveScheduledRetry(_delayMs: number): Promise<void> {
  return Promise.resolve()
}

function questionIdsOf(items: ReadonlyArray<{ questionId: string }>): string[] {
  return items.map((item) => item.questionId).sort()
}

function toAppliedFlushItem(item: { questionId: string }) {
  return { questionId: item.questionId, status: "applied" as const }
}

function offlineBannerHasThreePending(): void {
  expect(screen.getByTestId("offline-banner")).toHaveTextContent(
    "Waiting to be sent: 3",
  )
}

function offlineBannerIsGone(): void {
  expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument()
}

function allVisibleRadiosAreEnabled(): boolean {
  return screen
    .getAllByRole("radio")
    .every((radio) => !radio.hasAttribute("disabled"))
}

async function readingQueueIsEmpty(): Promise<void> {
  expect(
    await getQueue().snapshotForSection("attempt-1", "section-reading"),
  ).toHaveLength(0)
}

/**
 * Hoisted for the same reason as `fetchWasCalled`/`positionWasWritten`
 * above -- used by the B3 reload-recovery describe block below, which is
 * already two describes deep.
 */
const catRadioIsChecked = (): void => {
  expect(screen.getByRole("radio", { name: "A cat" })).toHaveAttribute(
    "aria-checked",
    "true",
  )
}

const cityRadioIsChecked = (): void => {
  expect(screen.getByRole("radio", { name: "A city" })).toHaveAttribute(
    "aria-checked",
    "true",
  )
}

const cappedAudio: CappedStimulusWire = {
  id: "stim-1",
  type: "audio",
  maxPlays: 2,
  playsUsed: 0,
  allowPause: false,
  allowSeek: false,
}

const listeningEnvelope: RunnerEnvelope = {
  id: "attempt-1",
  status: "in_progress",
  attemptNumber: 1,
  testTitle: "Practice Test 04",
  expiresAt: "2026-08-27T10:00:00.000Z",
  serverTime: "2026-08-27T09:00:00.000Z",
  questionCount: 20,
  answeredCount: 0,
  unansweredOrdinals: [3, 4],
  currentSectionId: "section-listening",
  currentQuestionId: "q-1",
  sections: [
    {
      id: "section-listening",
      type: "listening",
      title: "Listening — Part 1",
      questionCount: 2,
      durationSeconds: 1500,
      instructions: ["Put your headphones on now."],
      status: "open",
      completedAt: null,
      navigation: "forward_only",
      allowAnswerChange: false,
      expiresAt: "2026-08-27T09:25:00.000Z",
      groups: [
        {
          id: "group-1",
          stimulus: cappedAudio,
          questions: [
            {
              id: "q-1",
              ordinal: 3,
              type: "single_choice",
              prompt: "What did the boy see?",
              choices: [
                { id: "c-1", label: "A dog" },
                { id: "c-2", label: "A cat" },
              ],
            },
            {
              id: "q-2",
              ordinal: 4,
              type: "single_choice",
              prompt: "Where was he?",
              choices: [
                { id: "c-3", label: "The park" },
                { id: "c-4", label: "School" },
              ],
            },
          ],
        },
      ],
    },
  ],
  responses: [],
}

const finalizedAttempt = {
  id: "attempt-1",
  status: "expired" as const,
  submittedAt: "2026-08-28T10:00:01.000Z",
  resultUrl: "/attempts/attempt-1/result",
}

// A multi_choice question is graded by exact set equality
// (@pp/common/scoring's isQuestionCorrect) -- no fixture anywhere in this
// package constructed one before this fix, which is exactly how a
// single-select-only ChoiceList made every multi_choice question
// unanswerable without a single test catching it.
const multiChoiceEnvelope: RunnerEnvelope = {
  id: "attempt-1",
  status: "in_progress",
  attemptNumber: 1,
  testTitle: "Practice Test 04",
  expiresAt: "2026-08-27T10:00:00.000Z",
  serverTime: "2026-08-27T09:00:00.000Z",
  questionCount: 20,
  answeredCount: 0,
  unansweredOrdinals: [3, 4],
  currentSectionId: "section-listening",
  currentQuestionId: "q-1",
  sections: [
    {
      id: "section-listening",
      type: "listening",
      title: "Listening — Part 1",
      questionCount: 2,
      durationSeconds: 1500,
      instructions: ["Put your headphones on now."],
      status: "open",
      completedAt: null,
      navigation: "forward_only",
      // Unlike listeningEnvelope, this is allowAnswerChange: true, so these
      // tests exercise the multi-select MECHANICS without the lock policy
      // confounding them. The no-changes-allowed case is covered separately
      // below, and it is not a hypothetical: locking on the first checkbox
      // left a multi_choice question permanently half-answered, which
      // exact-set-equality grading then marks wrong.
      allowAnswerChange: true,
      expiresAt: "2026-08-27T09:25:00.000Z",
      groups: [
        {
          id: "group-1",
          stimulus: cappedAudio,
          questions: [
            {
              id: "q-1",
              ordinal: 3,
              type: "multi_choice",
              prompt: "Which animals did the boy see?",
              choices: [
                { id: "c-1", label: "A dog" },
                { id: "c-2", label: "A cat" },
                { id: "c-3", label: "A bird" },
              ],
            },
            {
              id: "q-2",
              ordinal: 4,
              type: "single_choice",
              prompt: "Where was he?",
              choices: [
                { id: "c-4", label: "The park" },
                { id: "c-5", label: "School" },
              ],
            },
          ],
        },
      ],
    },
  ],
  responses: [],
}

const passageOne: RunnerEnvelope["sections"][number]["groups"][number]["stimulus"] =
  {
    id: "stim-r1",
    type: "passage",
    bodyText: "Once there was a curious fox who lived at the edge of a forest.",
    maxPlays: null,
  }

const passageTwo: RunnerEnvelope["sections"][number]["groups"][number]["stimulus"] =
  {
    id: "stim-r2",
    type: "passage",
    bodyText: "The city library opens at nine every morning.",
    maxPlays: null,
  }

const readingEnvelope: RunnerEnvelope = {
  id: "attempt-1",
  status: "in_progress",
  attemptNumber: 1,
  testTitle: "Practice Test 04",
  expiresAt: "2026-08-27T10:00:00.000Z",
  serverTime: "2026-08-27T09:00:00.000Z",
  questionCount: 20,
  answeredCount: 0,
  unansweredOrdinals: [5, 6, 7, 8],
  currentSectionId: "section-reading",
  currentQuestionId: "q-r2",
  sections: [
    {
      id: "section-reading",
      type: "reading",
      title: "Reading",
      questionCount: 4,
      durationSeconds: 1500,
      instructions: [],
      status: "open",
      completedAt: null,
      navigation: "free",
      allowAnswerChange: true,
      expiresAt: "2026-08-27T09:30:00.000Z",
      groups: [
        {
          id: "group-r1",
          stimulus: passageOne,
          questions: [
            {
              id: "q-r1",
              ordinal: 5,
              type: "single_choice",
              prompt: "What animal is in the story?",
              choices: [
                { id: "cr-1", label: "A fox" },
                { id: "cr-2", label: "A bear" },
              ],
            },
            {
              id: "q-r2",
              ordinal: 6,
              type: "single_choice",
              prompt: "Where does the fox live?",
              choices: [
                { id: "cr-3", label: "A forest" },
                { id: "cr-4", label: "A city" },
              ],
            },
          ],
        },
        {
          id: "group-r2",
          stimulus: passageTwo,
          questions: [
            {
              id: "q-r3",
              ordinal: 7,
              type: "single_choice",
              prompt: "What time does the library open?",
              choices: [
                { id: "cr-5", label: "Nine" },
                { id: "cr-6", label: "Ten" },
              ],
            },
            {
              id: "q-r4",
              ordinal: 8,
              type: "single_choice",
              prompt: "What kind of building is it?",
              choices: [
                { id: "cr-7", label: "A library" },
                { id: "cr-8", label: "A school" },
              ],
            },
          ],
        },
      ],
    },
  ],
  responses: [],
}

const sectionBoundaryEnvelope: RunnerEnvelope = {
  ...listeningEnvelope,
  currentQuestionId: "q-2",
  sections: [
    listeningEnvelope.sections[0],
    {
      ...readingEnvelope.sections[0],
      status: "pending",
      expiresAt: null,
    },
  ],
}

// Opened fresh in `beforeEach` below (real `AnswerQueue`, IndexedDB-backed
// via `fake-indexeddb/auto` -- matching the pattern already established by
// `attempts.$attemptId.hand-in.test.tsx`), so every test starts from an
// empty queue and can inspect exactly what `handleSelectChoice` durably
// recorded. `undefined` between tests, never read except through
// `getQueue()`, which is what keeps this honestly typed without a
// non-null assertion (banned by this repo's oxlint config).
let queue: AnswerQueue | undefined = undefined

function getQueue(): AnswerQueue {
  if (!queue) {
    throw new Error("AnswerQueue not opened -- beforeEach did not run yet")
  }

  return queue
}

function renderRunScreen(
  envelope: RunnerEnvelope = listeningEnvelope,
  navigate = vi.fn(),
  clockOrOptions:
    | (() => number)
    | {
        readonly now?: () => number
        readonly flushScheduler?: Scheduler
      } = {},
) {
  const now =
    typeof clockOrOptions === "function" ? clockOrOptions : clockOrOptions.now
  const flushScheduler =
    typeof clockOrOptions === "function"
      ? undefined
      : clockOrOptions.flushScheduler
  const utils = render(
    <RunScreen
      attemptId="attempt-1"
      envelope={envelope}
      queue={getQueue()}
      navigate={navigate}
      now={now}
      flushScheduler={flushScheduler}
    />,
  )

  return { ...utils, navigate }
}

describe("RunScreen", () => {
  // A default fetch stub for every test in this describe, not just the ones
  // that assert on it: selecting a choice now durably records the answer
  // AND fires a flush (see `handleSelectChoice`), so any test that clicks a
  // choice needs a fetch response to resolve against, not the real global
  // fetch. Individual tests below overwrite this stub when they need to
  // inspect what was sent.
  beforeEach(async () => {
    indexedDB.deleteDatabase(DB_NAME)
    queue = await AnswerQueue.open(DB_NAME)
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )
  })

  afterEach(async () => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    await getQueue().close()
  })

  describe("route data", () => {
    it("loads the attempt and current student together", async () => {
      const student = {
        id: "student-1",
        displayName: "Tom Nguyen",
        email: "tom@example.com",
        level: "primary-step-1" as const,
        isAdmin: false,
      }
      mockGetRunnerEnvelope.mockResolvedValue(listeningEnvelope)
      mockGetCurrentStudent.mockResolvedValue(student)

      await expect(loadRunScreenData("attempt-1")).resolves.toEqual({
        envelope: listeningEnvelope,
        student,
      })
    })

    it("keeps the runner load successful when the optional identity fetch fails", async () => {
      mockGetRunnerEnvelope.mockResolvedValue(listeningEnvelope)
      mockGetCurrentStudent.mockRejectedValue(
        new ApiError({
          type: "not_found",
          title: "No profile for this sub — call POST /session first",
          status: 404,
        }),
      )

      await expect(loadRunScreenData("attempt-1")).resolves.toEqual({
        envelope: listeningEnvelope,
        student: undefined,
      })
    })
  })

  // Defect A: run.tsx had no errorComponent, so a network blip mid-test
  // dropped a child onto TanStack Router's bare default error page. The
  // loader is wrapped as `loadRunRouteData` (exported, above) so both halves
  // of the fix -- the 410 redirect and the fallback to RunRouteError -- are
  // testable directly, matching result.tsx's own `loadResult` convention.
  describe("loadRunRouteData / RunRouteError", () => {
    const openedQueues: AnswerQueue[] = []
    let openSpy: MockInstance | undefined = undefined

    beforeEach(() => {
      // Captured BEFORE `spyOn` runs: `spyOn` replaces `AnswerQueue.open`
      // with the spy as a side effect of the call itself, so reading
      // `AnswerQueue.open` afterwards (even in the same expression, as an
      // argument evaluated after that side effect) would capture the SPY,
      // not the real implementation -- `tracked` calling "the original"
      // would then call itself, infinitely.
      const originalOpen = AnswerQueue.open.bind(AnswerQueue)

      openSpy = vi
        .spyOn(AnswerQueue, "open")
        .mockImplementation(trackingOpener(originalOpen, openedQueues))
    })

    afterEach(async () => {
      openSpy?.mockRestore()
      await Promise.all(openedQueues.splice(0).map(closeQueue))
    })

    it("redirects to the result screen on a 410 attempt_expired, rather than erroring", async () => {
      mockGetRunnerEnvelope.mockRejectedValue(
        new ApiError({
          type: "attempt_expired",
          title: "The attempt was past its deadline and has been finalized.",
          status: 410,
          attempt: {
            id: "attempt-1",
            status: "expired",
            submittedAt: "2026-08-27T09:25:00.000Z",
            resultUrl: "/attempts/attempt-1/result",
          },
        }),
      )

      const thrown: unknown =
        await loadRunRouteData("attempt-1").catch(asRejectionValue)

      expect(isRedirect(thrown)).toBe(true)

      if (!isRedirect(thrown)) {
        throw new Error("Expected a TanStack Router redirect")
      }

      expect(thrown.options.href).toBe("/attempts/attempt-1/result")
    })

    it("propagates a plain network failure for RunRouteError to render", async () => {
      mockGetRunnerEnvelope.mockRejectedValue(new TypeError("Failed to fetch"))

      await expect(loadRunRouteData("attempt-1")).rejects.toBeInstanceOf(
        TypeError,
      )
    })

    it("renders an honest, actionable message -- reassures answers are safe, offers a retry", () => {
      render(<RunRouteError error={new TypeError("Failed to fetch")} />)

      expect(screen.getByRole("alert")).toHaveTextContent("Nothing is lost")
      expect(
        screen.getByRole("button", { name: "Try again" }),
      ).toBeInTheDocument()
    })

    it("reloads the page rather than losing queued answers on a silent client-side retry", async () => {
      const reload = vi.fn()
      // Not `{ ...window.location, reload }`: `Location` is a class
      // instance, and spreading one loses its prototype (oxlint's
      // `no-misused-spread`). RunRouteError's retry button only ever calls
      // `window.location.reload()`, so a minimal stand-in is both enough
      // and honest about what this test actually exercises.
      vi.stubGlobal("location", { reload })
      const user = userEvent.setup()

      render(<RunRouteError error={new TypeError("Failed to fetch")} />)
      await user.click(screen.getByRole("button", { name: "Try again" }))

      expect(reload).toHaveBeenCalledOnce()
    })
  })

  it("renders ListeningRunner when the current section's type is listening", () => {
    renderRunScreen()

    expect(screen.getByTestId("listening-runner")).toBeInTheDocument()
  })

  describe("attempt countdown", () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it("renders server-based remaining time and decreases when the injected clock advances", () => {
      const clock = new TestClock(Date.parse("2026-08-28T11:00:00.000Z"))
      renderRunScreen(
        {
          ...listeningEnvelope,
          expiresAt: "2026-08-28T10:25:00.000Z",
          serverTime: "2026-08-28T10:00:00.000Z",
        },
        undefined,
        clock.read.bind(clock),
      )

      expect(screen.getByLabelText("Time remaining")).toHaveTextContent("25:00")

      advanceClock(clock, 1_000)

      expect(screen.getByLabelText("Time remaining")).toHaveTextContent("24:59")
    })

    it("switches from the normal treatment to a calm at-risk treatment below five minutes", () => {
      const clock = new TestClock(Date.parse("2026-08-28T11:00:00.000Z"))
      renderRunScreen(
        {
          ...listeningEnvelope,
          expiresAt: "2026-08-28T10:05:01.000Z",
          serverTime: "2026-08-28T10:00:00.000Z",
        },
        undefined,
        clock.read.bind(clock),
      )

      const timer = screen.getByLabelText("Time remaining")
      expect(timer.className).toContain("text-ink-2")
      expect(timer.className).not.toContain("text-clay")

      advanceClock(clock, 2_000)

      expect(timer.className).toContain("text-clay")
    })

    it("stops reading the clock after the runner unmounts", () => {
      const clock = new TestClock(Date.parse("2026-08-28T11:00:00.000Z"))
      const { unmount } = renderRunScreen(
        {
          ...listeningEnvelope,
          expiresAt: "2026-08-28T10:25:00.000Z",
          serverTime: "2026-08-28T10:00:00.000Z",
        },
        undefined,
        clock.read.bind(clock),
      )

      expect(clock.reads).toBeGreaterThan(0)

      unmount()
      const readsAtUnmount = clock.reads

      advanceClock(clock, 2_000)

      expect(clock.reads).toBe(readsAtUnmount)
    })
  })

  describe("when the attempt countdown reaches zero", () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it("touches the attempt and carries the server's 410 payload to the time-up route", async () => {
      const clock = new TestClock(Date.parse("2026-08-28T11:00:00.000Z"))
      mockGetRunnerEnvelope.mockRejectedValue(
        new ApiError({
          type: "attempt_expired",
          title: "The attempt was past its deadline and has been finalized.",
          status: 410,
          attempt: finalizedAttempt,
        }),
      )
      const { navigate } = renderRunScreen(
        {
          ...listeningEnvelope,
          expiresAt: "2026-08-28T10:00:01.000Z",
          serverTime: "2026-08-28T10:00:00.000Z",
        },
        undefined,
        clock.read.bind(clock),
      )

      await advanceClockAndFlush(clock, 1_000)

      expect(mockGetRunnerEnvelope).toHaveBeenCalledExactlyOnceWith("attempt-1")
      expect(navigate).toHaveBeenCalledExactlyOnceWith(
        "/attempts/attempt-1/time-up",
        { attempt: finalizedAttempt },
      )
    })

    it("keeps the child in the runner when the server says the attempt is still active", async () => {
      const clock = new TestClock(Date.parse("2026-08-28T11:00:00.000Z"))
      mockGetRunnerEnvelope.mockResolvedValue({
        ...listeningEnvelope,
        expiresAt: "2026-08-28T10:00:10.000Z",
        serverTime: "2026-08-28T10:00:01.000Z",
      })
      const { navigate } = renderRunScreen(
        {
          ...listeningEnvelope,
          expiresAt: "2026-08-28T10:00:01.000Z",
          serverTime: "2026-08-28T10:00:00.000Z",
        },
        undefined,
        clock.read.bind(clock),
      )

      await advanceClockAndFlush(clock, 1_000)

      expect(navigate).not.toHaveBeenCalled()
      expect(screen.getByTestId("listening-runner")).toBeInTheDocument()
      expect(screen.getByLabelText("Time remaining")).toHaveTextContent("00:09")
    })

    it("touches the attempt only once while the zero display keeps ticking", async () => {
      const clock = new TestClock(Date.parse("2026-08-28T11:00:00.000Z"))
      mockGetRunnerEnvelope.mockRejectedValue(
        new ApiError({
          type: "attempt_expired",
          title: "The attempt was past its deadline and has been finalized.",
          status: 410,
          attempt: finalizedAttempt,
        }),
      )
      renderRunScreen(
        {
          ...listeningEnvelope,
          expiresAt: "2026-08-28T10:00:01.000Z",
          serverTime: "2026-08-28T10:00:00.000Z",
        },
        undefined,
        clock.read.bind(clock),
      )

      await advanceClockAndFlush(clock, 6_000)

      expect(mockGetRunnerEnvelope).toHaveBeenCalledOnce()
    })
  })

  describe("runner panels", () => {
    it("opens the menu when its trigger is clicked", async () => {
      renderRunScreen()

      await userEvent.click(screen.getByRole("button", { name: "Open menu" }))

      expect(screen.getByRole("dialog", { name: "Menu" })).toBeInTheDocument()
    })

    it("closes the menu and opens the navigator when its trigger is clicked while the menu is open", async () => {
      renderRunScreen()

      await userEvent.click(screen.getByRole("button", { name: "Open menu" }))
      await userEvent.click(
        screen.getByRole("button", {
          name: "Open the question navigator",
        }),
      )

      expect(screen.getAllByRole("dialog")).toHaveLength(1)
      expect(
        screen.getByRole("dialog", { name: "Questions" }),
      ).toBeInTheDocument()
    })

    it("closes whichever panel is open on Escape", async () => {
      renderRunScreen()

      await userEvent.click(screen.getByRole("button", { name: "Open menu" }))
      await userEvent.keyboard("{Escape}")

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })

    it("uses 44px touch targets for both runner-chrome triggers", () => {
      renderRunScreen()

      expect(
        screen.getByRole("button", { name: "Open menu" }).className,
      ).toContain("size-11")
      expect(
        screen.getByRole("button", {
          name: "Open the question navigator",
        }).className,
      ).toContain("size-11")
    })

    it("never writes position when a disabled forward-only cell is clicked", async () => {
      renderRunScreen()

      await userEvent.click(
        screen.getByRole("button", {
          name: "Open the question navigator",
        }),
      )
      await userEvent.click(screen.getByRole("button", { name: "Question 4" }))

      expect(mockSetPosition).not.toHaveBeenCalled()
    })

    it("writes position and closes the navigator when an enabled cell is clicked", async () => {
      mockSetPosition.mockResolvedValue(undefined)
      renderRunScreen(readingEnvelope)

      await userEvent.click(
        screen.getByRole("button", {
          name: "Open the question navigator",
        }),
      )
      await userEvent.click(screen.getByRole("button", { name: "Question 7" }))

      await waitFor(positionWasWritten)

      expect(mockSetPosition).toHaveBeenCalledExactlyOnceWith(
        "attempt-1",
        "section-reading",
        "q-r3",
      )
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })
  })

  it("redirects to the section-rules route when currentSectionId is null", () => {
    const { navigate } = renderRunScreen({
      ...listeningEnvelope,
      currentSectionId: null,
      currentQuestionId: null,
    })

    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      "/attempts/attempt-1/sections/section-listening/rules",
    )
    expect(screen.queryByTestId("listening-runner")).not.toBeInTheDocument()
  })

  it("renders the current question's prompt and choices from currentQuestionId", () => {
    renderRunScreen()

    expect(screen.getByText("What did the boy see?")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "A dog" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "A cat" })).toBeInTheDocument()
  })

  it("hides the play button's disabled state until playsUsed reaches maxPlays", async () => {
    mockClaimPlay.mockResolvedValue({
      stimulusId: "stim-1",
      playsUsed: 2,
      playsRemaining: 0,
      mediaUrl: "/api/media/audio1.mp3?exp=1&sig=x",
      urlExpiresAt: "2026-08-27T09:01:00.000Z",
    })
    const user = userEvent.setup()

    renderRunScreen()

    const button = screen.getByRole("button", { name: "Play recording" })
    expect(button).toBeEnabled()

    await user.click(button)

    await waitFor(() => {
      expect(button).toBeDisabled()
    })
  })

  it("calls claimPlay when the play button is clicked, and only then sets the audio src", async () => {
    mockClaimPlay.mockResolvedValue({
      stimulusId: "stim-1",
      playsUsed: 1,
      playsRemaining: 1,
      mediaUrl: "/api/media/audio1.mp3?exp=1&sig=x",
      urlExpiresAt: "2026-08-27T09:01:00.000Z",
    })
    const user = userEvent.setup()

    renderRunScreen()

    expect(screen.queryByTestId("audio-player")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Play recording" }))

    expect(mockClaimPlay).toHaveBeenCalledExactlyOnceWith("attempt-1", "stim-1")
    expect(await screen.findByTestId("audio-player")).toHaveAttribute(
      "src",
      "/api/media/audio1.mp3?exp=1&sig=x",
    )
  })

  // Replaces the old "holds a new choice selection in local state only --
  // no network call fires on select" test, which encoded the defect this
  // fix closes: a selection that lived in React state ONLY, discarded on
  // reload, was exactly why a child sitting a timed test could be graded
  // "0 answered" on a test they had actually completed. These two tests
  // prove the opposite -- a selection survives a tab close from the moment
  // it is tapped (durably queued in IndexedDB) and reaches the server.
  // My own gap, found by the review's test-quality pass. `clockStarted` was
  // hardcoded `true`, so the menu told a child "the clock keeps running
  // while you are away" before they had started anything -- false, and
  // exactly what would stop a child leaving a test they had not begun. I
  // fixed the wiring and did not test it. AppMenu covers both branches of
  // the COMPONENT; nothing asserted the run shell passes the right value.
  //
  // openapi.yaml is explicit that an attempt's expiresAt "stays null until
  // the first section entry", so that null IS the not-started signal.
  it("tells the child the clock is running only once the attempt has a deadline", async () => {
    const user = userEvent.setup()

    renderRunScreen()
    await user.click(screen.getByRole("button", { name: "Open menu" }))

    expect(
      screen.getByText("The clock keeps running while you are away."),
    ).toBeInTheDocument()

    cleanup()

    renderRunScreen({ ...listeningEnvelope, expiresAt: null })
    await user.click(screen.getByRole("button", { name: "Open menu" }))

    expect(
      screen.getByText(
        "Nothing has started yet. The clock begins when you tap I'm ready.",
      ),
    ).toBeInTheDocument()
  })

  it("durably records a new choice selection in the local answer queue immediately on select", async () => {
    const user = userEvent.setup()

    renderRunScreen()

    await user.click(screen.getByRole("radio", { name: "A cat" }))

    expect(screen.getByRole("radio", { name: "A cat" })).toHaveAttribute(
      "aria-checked",
      "true",
    )

    const [firstQueued] = await waitFor(async () => {
      const items = await getQueue().snapshotForSection(
        "attempt-1",
        "section-listening",
      )

      expect(items).toHaveLength(1)

      return items
    })

    expect(firstQueued).toMatchObject({
      attemptId: "attempt-1",
      sectionId: "section-listening",
      questionId: "q-1",
      selectedChoiceIds: ["c-2"],
    })
  })

  it("flushes a newly recorded answer to the server as a PATCH /attempts/{id}/responses snapshot", async () => {
    const user = userEvent.setup()

    renderRunScreen()

    await user.click(screen.getByRole("radio", { name: "A cat" }))

    await waitFor(fetchWasCalled)

    const [call] = vi.mocked(fetch).mock.calls
    const [url, init] = call

    expect(url).toBe("/api/attempts/attempt-1/responses")
    expect(init?.method).toBe("PATCH")

    const body: unknown = JSON.parse(
      (init?.body as string | undefined) ?? "null",
    )
    expect(body).toMatchObject({
      responses: [
        expect.objectContaining({
          questionId: "q-1",
          selectedChoiceIds: ["c-2"],
        }),
      ],
    })
  })

  it("shows retryable queued work with reassurance and clears it after the next successful flush", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")),
    )
    const user = userEvent.setup()

    renderRunScreen(readingEnvelope, undefined, {
      flushScheduler: resolveScheduledRetry,
    })

    await user.click(screen.getByRole("radio", { name: "A city" }))

    const banner = await screen.findByTestId("offline-banner")
    expect(banner).toHaveTextContent("We can't reach the server right now.")
    expect(banner).toHaveTextContent(
      "Keep answering — your answers are saved on this iPad and will be sent as soon as the connection is back.",
    )
    expect(banner).toHaveTextContent("Waiting to be sent: 1")

    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ questionId: "q-r2", status: "applied" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    window.dispatchEvent(new Event("online"))

    await waitFor(() => {
      expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument()
    })
    expect(screen.getByRole("status")).toHaveTextContent("Saved")
  })

  it("keeps answer controls enabled and records a new selection while the offline banner is showing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")),
    )
    const user = userEvent.setup()

    renderRunScreen(readingEnvelope, undefined, {
      flushScheduler: resolveScheduledRetry,
    })

    await user.click(screen.getByRole("radio", { name: "A city" }))
    await screen.findByTestId("offline-banner")

    const nextAnswer = screen.getByRole("radio", { name: "A forest" })
    expect(nextAnswer).toBeEnabled()
    await user.click(nextAnswer)

    const [queued] = await waitFor(async () => {
      const items = await getQueue().snapshotForSection(
        "attempt-1",
        "section-reading",
      )

      expect(items).toHaveLength(1)

      return items
    })
    expect(queued.selectedChoiceIds).toEqual(["cr-3"])
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument()
  })

  // Defect B5: a terminal per-item rejection used to reach this page and be
  // discarded -- FlushController already classified it correctly (never
  // resent, per spec §5 rule 5's "stop dead"), but nothing told the child.
  // The selection stays visibly selected (it is NOT reverted -- the child
  // did make that choice, and reverting it silently would be its own kind
  // of dishonesty), alongside an honest notice that it did not save.
  it("tells the child when the server terminally rejects their answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [{ questionId: "q-1", status: "rejected" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    )
    const user = userEvent.setup()

    renderRunScreen()

    await user.click(screen.getByRole("radio", { name: "A cat" }))

    expect(await screen.findByTestId("save-failed-notice")).toHaveTextContent(
      "didn't save",
    )
    expect(screen.getByRole("status")).toHaveTextContent("Did not save")
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument()
    // The selection itself is untouched -- still visibly checked.
    expect(screen.getByRole("radio", { name: "A cat" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
  })

  it("clears an earlier save-failed notice once the child changes that answer again", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              results: [{ questionId: "q-1", status: "rejected" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValue(
          new Response(JSON.stringify({ results: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    )
    const user = userEvent.setup()
    const [section] = listeningEnvelope.sections
    // Answer changes must be allowed for this test to actually re-tap the
    // SAME question a second time -- `allowAnswerChange: false` (the
    // default fixture) locks it after the first selection, which is a
    // different scenario this test is not about.
    const envelope: RunnerEnvelope = {
      ...listeningEnvelope,
      sections: [{ ...section, allowAnswerChange: true }],
    }

    renderRunScreen(envelope)

    await user.click(screen.getByRole("radio", { name: "A cat" }))
    expect(await screen.findByTestId("save-failed-notice")).toBeInTheDocument()

    await user.click(screen.getByRole("radio", { name: "A dog" }))

    await waitFor(() => {
      expect(screen.queryByTestId("save-failed-notice")).not.toBeInTheDocument()
    })
  })

  // The half of the multi_choice defect that survived the first fix.
  // `locked` fired on the FIRST selection, which is correct for
  // single_choice ("your answer is final") but left a multi_choice question
  // in a no-changes section permanently half-answered -- and then graded
  // wrong, since isQuestionCorrect requires the set to match exactly.
  // Nothing in the schema stops a multi_choice question sitting in such a
  // section: allow_answer_change is per-section, type is per-question, and
  // no constraint links them.
  it("lets a multi_choice question be fully answered even when the section forbids answer changes", async () => {
    const user = userEvent.setup()
    const [section] = multiChoiceEnvelope.sections
    const envelope: RunnerEnvelope = {
      ...multiChoiceEnvelope,
      sections: [{ ...section, allowAnswerChange: false }],
    }

    renderRunScreen(envelope)

    await user.click(screen.getByRole("checkbox", { name: "A dog" }))
    await user.click(screen.getByRole("checkbox", { name: "A bird" }))

    expect(screen.getByRole("checkbox", { name: "A dog" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    expect(screen.getByRole("checkbox", { name: "A bird" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
  })

  it("durably records BOTH ids when two checkboxes are tapped on a multi_choice question", async () => {
    const user = userEvent.setup()

    renderRunScreen(multiChoiceEnvelope)

    await user.click(screen.getByRole("checkbox", { name: "A dog" }))
    await user.click(screen.getByRole("checkbox", { name: "A bird" }))

    expect(screen.getByRole("checkbox", { name: "A dog" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    expect(screen.getByRole("checkbox", { name: "A cat" })).toHaveAttribute(
      "aria-checked",
      "false",
    )
    expect(screen.getByRole("checkbox", { name: "A bird" })).toHaveAttribute(
      "aria-checked",
      "true",
    )

    const [queued] = await waitFor(async () => {
      const items = await getQueue().snapshotForSection(
        "attempt-1",
        "section-listening",
      )

      expect(items).toHaveLength(1)

      return items
    })

    // Exact set equality (isQuestionCorrect, @pp/common/scoring) is what
    // this whole fix is for -- a selection that lost either id here would
    // grade a fully-correct multi_choice answer as wrong.
    expect(queued).toMatchObject({
      questionId: "q-1",
      selectedChoiceIds: ["c-1", "c-3"],
    })
  })

  it("removes an id from the recorded selection when its checkbox is tapped again", async () => {
    const user = userEvent.setup()

    renderRunScreen(multiChoiceEnvelope)

    await user.click(screen.getByRole("checkbox", { name: "A dog" }))
    await user.click(screen.getByRole("checkbox", { name: "A cat" }))
    await user.click(screen.getByRole("checkbox", { name: "A dog" }))

    expect(screen.getByRole("checkbox", { name: "A dog" })).toHaveAttribute(
      "aria-checked",
      "false",
    )

    const [queued] = await waitFor(async () => {
      const items = await getQueue().snapshotForSection(
        "attempt-1",
        "section-listening",
      )

      expect(items).toHaveLength(1)

      return items
    })

    expect(queued).toMatchObject({
      questionId: "q-1",
      selectedChoiceIds: ["c-2"],
    })
  })

  // Defect B3: the queue opened on mount was never READ from -- an answer
  // recorded before a crash/reload survived in IndexedDB (that half of
  // "durable before sent" already worked) but stayed invisible to the
  // screen and was never re-sent, because `responses` state was seeded
  // solely from `envelope.responses`. A reload's own envelope naturally
  // carries no record of an answer the server never acknowledged, so this
  // simulates exactly that: an item already sitting in the queue when
  // RunScreen mounts, with an envelope that (correctly, honestly) knows
  // nothing about it yet.
  describe("reload recovery (B3): restoring what the queue already held on mount", () => {
    it("shows a queued-but-unacked answer as selected, not blank", async () => {
      await getQueue().recordAnswer(
        {
          attemptId: "attempt-1",
          sectionId: "section-listening",
          questionId: "q-1",
          selectedChoiceIds: ["c-2"],
          timeSpentMs: null,
        },
        new Date("2026-08-27T09:00:00.000Z"),
      )

      renderRunScreen()

      await waitFor(catRadioIsChecked)
    })

    it("re-flushes the restored answer to the server without waiting for another tap", async () => {
      await getQueue().recordAnswer(
        {
          attemptId: "attempt-1",
          sectionId: "section-listening",
          questionId: "q-1",
          selectedChoiceIds: ["c-2"],
          timeSpentMs: null,
        },
        new Date("2026-08-27T09:00:00.000Z"),
      )

      renderRunScreen()

      await waitFor(fetchWasCalled)

      const [call] = vi.mocked(fetch).mock.calls
      const [url, init] = call

      expect(url).toBe("/api/attempts/attempt-1/responses")
      const body: unknown = JSON.parse(
        (init?.body as string | undefined) ?? "null",
      )
      expect(body).toMatchObject({
        responses: [
          expect.objectContaining({
            questionId: "q-1",
            selectedChoiceIds: ["c-2"],
          }),
        ],
      })
    })

    it("does not clobber a queued answer with an older server-known response for the same question", async () => {
      await getQueue().recordAnswer(
        {
          attemptId: "attempt-1",
          sectionId: "section-listening",
          questionId: "q-1",
          selectedChoiceIds: ["c-2"],
          timeSpentMs: null,
        },
        new Date("2026-08-27T09:00:00.000Z"),
      )

      // The server's own envelope may still carry a STALE answer for this
      // question (e.g. the last one it actually acked, before the queued
      // one above was ever sent) -- the locally queued value must win,
      // since it is the more recent one the child actually gave.
      renderRunScreen({
        ...listeningEnvelope,
        responses: [
          {
            questionId: "q-1",
            selectedChoiceIds: ["c-1"],
            clientInstanceId: "device-1",
            seq: 1,
          },
        ],
      })

      await waitFor(catRadioIsChecked)
      expect(screen.getByRole("radio", { name: "A dog" })).toHaveAttribute(
        "aria-checked",
        "false",
      )
    })
  })

  describe("offline durability end to end", () => {
    it("keeps three offline answers in IndexedDB, then sends one full snapshot when the connection returns", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")),
      )
      mockSetPosition.mockResolvedValue(undefined)
      const user = userEvent.setup()

      renderRunScreen(readingEnvelope, undefined, {
        flushScheduler: resolveScheduledRetry,
      })

      await user.click(screen.getByRole("radio", { name: "A city" }))
      expect(await screen.findByTestId("offline-banner")).toHaveTextContent(
        "Waiting to be sent: 1",
      )

      await user.click(screen.getByRole("button", { name: "Next" }))
      await user.click(screen.getByRole("radio", { name: "Nine" }))

      await user.click(screen.getByRole("button", { name: "Next" }))
      await user.click(screen.getByRole("radio", { name: "A library" }))

      const pending = await getQueue().snapshotForSection(
        "attempt-1",
        "section-reading",
      )
      expect(questionIdsOf(pending)).toEqual(["q-r2", "q-r3", "q-r4"])
      await waitFor(offlineBannerHasThreePending)
      expect(allVisibleRadiosAreEnabled()).toBe(true)

      vi.mocked(fetch).mockClear()
      vi.mocked(fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            results: pending.map(toAppliedFlushItem),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )

      window.dispatchEvent(new Event("online"))

      await waitFor(offlineBannerIsGone)

      expect(fetch).toHaveBeenCalledOnce()
      const [firstFetchCall] = vi.mocked(fetch).mock.calls
      const [url, init] = firstFetchCall
      const body = JSON.parse((init?.body as string | undefined) ?? "null") as {
        responses: Array<{ questionId: string }>
      }
      expect(url).toBe("/api/attempts/attempt-1/responses")
      expect(questionIdsOf(body.responses)).toEqual(["q-r2", "q-r3", "q-r4"])
      await waitFor(readingQueueIsEmpty)
    })

    it("restores three visible answers and a pending count of three after a reload mid-outage", async () => {
      const savedSelections = [
        { questionId: "q-r2", selectedChoiceIds: ["cr-4"] },
        { questionId: "q-r3", selectedChoiceIds: ["cr-5"] },
        { questionId: "q-r4", selectedChoiceIds: ["cr-7"] },
      ]

      for (const selection of savedSelections) {
        // eslint-disable-next-line no-await-in-loop
        await getQueue().recordAnswer(
          {
            attemptId: "attempt-1",
            sectionId: "section-reading",
            questionId: selection.questionId,
            selectedChoiceIds: selection.selectedChoiceIds,
            timeSpentMs: null,
          },
          new Date("2026-08-27T09:00:00.000Z"),
        )
      }

      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")),
      )
      mockSetPosition.mockResolvedValue(undefined)
      const user = userEvent.setup()

      renderRunScreen(readingEnvelope, undefined, {
        flushScheduler: resolveScheduledRetry,
      })

      expect(await screen.findByTestId("offline-banner")).toHaveTextContent(
        "Waiting to be sent: 3",
      )
      await waitFor(cityRadioIsChecked)

      await user.click(screen.getByRole("button", { name: "Next" }))
      expect(screen.getByRole("radio", { name: "Nine" })).toHaveAttribute(
        "aria-checked",
        "true",
      )

      await user.click(screen.getByRole("button", { name: "Next" }))
      expect(screen.getByRole("radio", { name: "A library" })).toHaveAttribute(
        "aria-checked",
        "true",
      )

      expect(
        await getQueue().snapshotForSection("attempt-1", "section-reading"),
      ).toHaveLength(3)
    })
  })

  it("locks the choice list once a response already exists for this question and allowAnswerChange is false", () => {
    renderRunScreen({
      ...listeningEnvelope,
      responses: [
        {
          questionId: "q-1",
          selectedChoiceIds: ["c-1"],
          clientInstanceId: "device-1",
          seq: 1,
        },
      ],
    })

    expect(
      screen.getByText("Answer locked — this section does not allow changes."),
    ).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "A dog" })).toBeDisabled()
  })

  it("shows no Previous button in a forward_only section", () => {
    renderRunScreen()

    expect(
      screen.queryByRole("button", { name: "Previous" }),
    ).not.toBeInTheDocument()
  })

  it("calls setPosition with the next question's id when Next is clicked", async () => {
    mockSetPosition.mockResolvedValue(undefined)
    const user = userEvent.setup()

    renderRunScreen()

    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(mockSetPosition).toHaveBeenCalledExactlyOnceWith(
      "attempt-1",
      "section-listening",
      "q-2",
    )
  })

  describe("section boundary", () => {
    it("offers the next section only on the current section's last question", () => {
      renderRunScreen({
        ...sectionBoundaryEnvelope,
        currentQuestionId: "q-1",
      })

      expect(
        screen.queryByRole("button", { name: "Continue to Reading" }),
      ).not.toBeInTheDocument()

      cleanup()
      renderRunScreen(sectionBoundaryEnvelope)

      expect(
        screen.getByRole("button", { name: "Continue to Reading" }),
      ).toBeInTheDocument()
    })

    it("finishes with an immediately tapped answer, reconciles it, and navigates to the returned rules screen", async () => {
      mockFinishSection.mockImplementation(finishWithAppliedRemainder)
      const { navigate } = renderRunScreen(sectionBoundaryEnvelope)
      const user = userEvent.setup()

      await user.click(screen.getByRole("radio", { name: "School" }))
      await user.click(
        screen.getByRole("button", { name: "Continue to Reading" }),
      )

      await waitFor(finishWasCalled)
      expect(mockFinishSection).toHaveBeenCalledWith(
        "attempt-1",
        "section-listening",
        expect.objectContaining({
          responses: [
            expect.objectContaining({
              questionId: "q-2",
              selectedChoiceIds: ["c-4"],
            }),
          ],
        }),
      )
      expect(navigate).toHaveBeenCalledExactlyOnceWith(
        "/attempts/attempt-1/sections/section-reading/rules",
      )
      await expect(
        getQueue().snapshotForSection("attempt-1", "section-listening"),
      ).resolves.toEqual([])
    })

    it("offers hand-in instead of a nonexistent next section on the final question", async () => {
      const finalEnvelope: RunnerEnvelope = {
        ...readingEnvelope,
        currentQuestionId: "q-r4",
      }
      const { navigate } = renderRunScreen(finalEnvelope)

      expect(
        screen.queryByRole("button", { name: "Continue to Reading" }),
      ).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole("button", { name: "Finish test" }))

      expect(mockFinishSection).not.toHaveBeenCalled()
      expect(navigate).toHaveBeenCalledExactlyOnceWith(
        "/attempts/attempt-1/hand-in",
      )
    })
  })

  it("renders the pip/progress strip from questionCount and the section's own question ordinals, read-only", () => {
    renderRunScreen()

    expect(screen.getByText("Question 3 of 20")).toBeInTheDocument()

    const pips = screen.getAllByTestId("question-pip")
    expect(pips.map((pip) => pip.textContent)).toEqual(["3", "4"])
    for (const pip of pips) {
      expect(pip.tagName).not.toBe("BUTTON")
    }
  })

  // Defect B: ListeningRunner's `<audio>` had no `onError`, so a stalled or
  // failed media load left `playState` stuck at `{status: "granted"}`
  // forever -- the play button disabled with no recovery, even though the
  // play itself was already counted server-side. `handleAudioError` (this
  // page) is the actual fix; ListeningRunner.test.tsx already proves the
  // presentational half (the element forwards its native `error` event).
  describe("a failed audio load recovers, honestly", () => {
    it("re-enables the play button and tells the child their play was used, without silently spending another", async () => {
      mockClaimPlay.mockResolvedValueOnce({
        stimulusId: "stim-1",
        playsUsed: 1,
        playsRemaining: 1,
        mediaUrl: "/api/media/audio1.mp3?exp=1&sig=x",
        urlExpiresAt: "2026-08-27T09:05:00.000Z",
      })
      const user = userEvent.setup()

      renderRunScreen()

      await user.click(screen.getByRole("button", { name: "Play recording" }))
      const audio = await screen.findByTestId("audio-player")

      expect(mockClaimPlay).toHaveBeenCalledTimes(1)

      fireEvent.error(audio)

      // The stuck-forever bug: before this fix, `playing` (and hence the
      // button's `disabled`) never went back to false once a play was
      // granted, because only `onEnded` -- never a failed load -- reset it.
      expect(
        await screen.findByRole("button", { name: "Play recording" }),
      ).toBeEnabled()
      expect(screen.getByRole("alert")).toHaveTextContent(
        "That play has been used",
      )
      // The other half of "honest": no second claim happened on its own.
      // Recovery is the child's own tap, not an automatic retry that would
      // spend a play they never asked for.
      expect(mockClaimPlay).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId("audio-player")).not.toBeInTheDocument()

      // A deliberate retap is a perfectly ordinary new claim, and clears
      // the failure message once it succeeds.
      mockClaimPlay.mockResolvedValueOnce({
        stimulusId: "stim-1",
        playsUsed: 2,
        playsRemaining: 0,
        mediaUrl: "/api/media/audio2.mp3?exp=1&sig=y",
        urlExpiresAt: "2026-08-27T09:06:00.000Z",
      })

      await user.click(screen.getByRole("button", { name: "Play recording" }))

      expect(await screen.findByTestId("audio-player")).toHaveAttribute(
        "src",
        "/api/media/audio2.mp3?exp=1&sig=y",
      )
      expect(mockClaimPlay).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    })

    it("does not invite a retry once the failed play was the last one available", async () => {
      mockClaimPlay.mockResolvedValueOnce({
        stimulusId: "stim-1",
        playsUsed: 2,
        playsRemaining: 0,
        mediaUrl: "/api/media/audio1.mp3?exp=1&sig=x",
        urlExpiresAt: "2026-08-27T09:05:00.000Z",
      })
      const user = userEvent.setup()

      renderRunScreen()

      await user.click(screen.getByRole("button", { name: "Play recording" }))
      const audio = await screen.findByTestId("audio-player")

      fireEvent.error(audio)

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "no plays left for this question",
      )
      // Honest about the OTHER direction too: the button reflects the real
      // play cap (exhausted), not the stuck-disabled bug this fix removes.
      expect(
        screen.getByRole("button", { name: "Play recording" }),
      ).toBeDisabled()
    })
  })

  // Carried over from Task 9: a capped stimulus's signed URL expires, and
  // openapi.yaml gives claimPlay exactly one way to report that -- the same
  // `SectionOrAttemptExpired` 410 every other runner call uses
  // (`section_expired` leaves the attempt running; `attempt_expired`
  // finalizes it and carries the finalized attempt). Before this task,
  // QuestionMedia swallowed the rejection and the student saw nothing.
  describe("a claimPlay 410 surfaces an actionable expired state, not silence", () => {
    it("shows the section-expired message on a 410 section_expired", async () => {
      mockClaimPlay.mockRejectedValue(
        new ApiError({
          type: "section_expired",
          title: "The section's clock ran out.",
          status: 410,
        }),
      )
      const user = userEvent.setup()

      renderRunScreen()

      await user.click(screen.getByRole("button", { name: "Play recording" }))

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This section's time ran out.",
      )
    })

    it("moves to time-up with the finalized attempt on a 410 attempt_expired", async () => {
      mockClaimPlay.mockRejectedValue(
        new ApiError({
          type: "attempt_expired",
          title: "The attempt was past its deadline and has been finalized.",
          status: 410,
          attempt: finalizedAttempt,
        }),
      )
      const user = userEvent.setup()

      const { navigate } = renderRunScreen()

      await user.click(screen.getByRole("button", { name: "Play recording" }))

      expect(navigate).toHaveBeenCalledExactlyOnceWith(
        "/attempts/attempt-1/time-up",
        { attempt: finalizedAttempt },
      )
    })
  })

  describe("reading section", () => {
    it("renders ReadingRunner when the current section's type is reading", () => {
      renderRunScreen(readingEnvelope)

      expect(screen.getByTestId("reading-runner")).toBeInTheDocument()
    })

    it("renders the current question's prompt and the shared passage text", () => {
      renderRunScreen(readingEnvelope)

      expect(screen.getByText("Where does the fox live?")).toBeInTheDocument()
      expect(
        screen.getByText(
          "Once there was a curious fox who lived at the edge of a forest.",
        ),
      ).toBeInTheDocument()
    })

    it("shows a Previous button, enabled -- unlike the forward_only listening section", () => {
      renderRunScreen(readingEnvelope)

      expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled()
    })

    it("calls setPosition with a PRIOR question's id when Previous is clicked", async () => {
      mockSetPosition.mockResolvedValue(undefined)
      const user = userEvent.setup()

      renderRunScreen(readingEnvelope)

      await user.click(screen.getByRole("button", { name: "Previous" }))

      expect(mockSetPosition).toHaveBeenCalledExactlyOnceWith(
        "attempt-1",
        "section-reading",
        "q-r1",
      )
      expect(
        await screen.findByText("What animal is in the story?"),
      ).toBeInTheDocument()
    })

    it("calls setPosition with the next question's id when Next is clicked", async () => {
      mockSetPosition.mockResolvedValue(undefined)
      const user = userEvent.setup()

      renderRunScreen(readingEnvelope)

      await user.click(screen.getByRole("button", { name: "Next" }))

      expect(mockSetPosition).toHaveBeenCalledExactlyOnceWith(
        "attempt-1",
        "section-reading",
        "q-r3",
      )
    })

    it("allows changing an already-selected choice, unlike listening", async () => {
      const user = userEvent.setup()

      renderRunScreen({
        ...readingEnvelope,
        responses: [
          {
            questionId: "q-r2",
            selectedChoiceIds: ["cr-3"],
            clientInstanceId: "device-1",
            seq: 1,
          },
        ],
      })

      expect(screen.getByRole("radio", { name: "A forest" })).toBeEnabled()
      expect(
        screen.queryByText(
          "Answer locked — this section does not allow changes.",
        ),
      ).not.toBeInTheDocument()

      await user.click(screen.getByRole("radio", { name: "A city" }))

      expect(screen.getByRole("radio", { name: "A city" })).toHaveAttribute(
        "aria-checked",
        "true",
      )

      // Selecting fires a durable-record-then-flush chain (see
      // `handleSelectChoice`) that this test does not otherwise assert on --
      // waited out here so it settles before `afterEach` closes the queue,
      // rather than racing an in-flight IndexedDB write against the close.
      await waitFor(fetchWasCalled)
    })

    it("renders 'Passage N · questions X–Y' from the current group's own ordinals", async () => {
      const user = userEvent.setup()

      renderRunScreen(readingEnvelope)

      expect(screen.getByText("Passage 1 · questions 5–6")).toBeInTheDocument()

      mockSetPosition.mockResolvedValue(undefined)
      await user.click(screen.getByRole("button", { name: "Next" }))

      expect(
        await screen.findByText("Passage 2 · questions 7–8"),
      ).toBeInTheDocument()
    })

    it("navigates to the hand-in dialog when Hand in is tapped", async () => {
      const { navigate } = renderRunScreen(readingEnvelope)

      await userEvent.click(screen.getByRole("button", { name: "Hand in" }))

      expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/hand-in"))
    })

    // Mirrors the claimPlay 410 coverage above: reading has no claimPlay
    // flow (its stimulus is always a passage), so `PUT /position` from
    // Previous/Next is the only way this attempt/section can discover its
    // own expiry client-side. Same SectionOrAttemptExpired shape, same
    // run-shell-owned expired state -- just reached through a different call.
    it("shows the section-expired message on a 410 section_expired from Previous", async () => {
      mockSetPosition.mockRejectedValue(
        new ApiError({
          type: "section_expired",
          title: "The section's clock ran out.",
          status: 410,
        }),
      )
      const user = userEvent.setup()

      renderRunScreen(readingEnvelope)

      await user.click(screen.getByRole("button", { name: "Previous" }))

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This section's time ran out.",
      )
    })
  })
})
