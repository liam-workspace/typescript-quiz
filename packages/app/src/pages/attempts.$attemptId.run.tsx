import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@liam-public/browser-react-ui"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useRef, useState, type JSX } from "react"
import { useTranslation } from "react-i18next"
import { AppMenu, type MenuStudent } from "../components/AppMenu.js"
import { ListeningRunner } from "../components/ListeningRunner.js"
import { QuestionNavigator } from "../components/QuestionNavigator.js"
import { ReadingRunner } from "../components/ReadingRunner.js"
import { AnswerQueue } from "../lib/answerQueue.js"
import { ApiError } from "../lib/api-client.js"
import {
  claimPlay,
  getRunnerEnvelope,
  setPosition,
} from "../lib/attempts-api.js"
import { redirectExpiredAttemptToResult } from "../lib/expired-attempt-redirect.js"
import { FlushController, type Scheduler } from "../lib/flushController.js"
import { apiFlushHttp } from "../lib/flushHttp.js"
import { registerPagehideFlush } from "../lib/lifecycleFlush.js"
import { sameOriginPath } from "../lib/same-origin-path.js"
import { getCurrentStudent } from "../lib/session-api.js"
import type { NavigatorSource } from "../lib/navigator-state.js"
import type {
  RunnerEnvelope,
  RunnerQuestion,
  RunnerSection,
  StimulusWire,
} from "../lib/api-types.js"

// The shared shell: loads ONE RunnerEnvelope (openapi.yaml `GET /attempts/{id}`,
// "ONE shape, read by the listening, reading, hand-in and recovery screens
// alike") and dispatches on the current section's type. ListeningRunner
// (Task 10) and ReadingRunner (Task 11) are both purely presentational --
// components/ is stateless by policy, frontend-lint's `stateless` rule
// rejects useState/useEffect/etc. as AST nodes anywhere under components/ --
// so this page is where all of it actually lives: the current question, the
// durably-queued (`AnswerQueue`, IndexedDB-backed) answer selections and
// their flush to the server, the claimed audio URL, and the expired-audio
// state that Tasks 8 and 9 each correctly declined (see ListeningRunner's
// ListeningExpiredState doc comment).

// A real setTimeout-backed scheduler for FlushController's retry backoff --
// the same shape FlushController's own tests inject a fake for, but here
// there is no fake clock to serve, so this actually waits.
const scheduler: Scheduler = (delayMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })

interface FlatEntry {
  readonly question: RunnerQuestion
  readonly stimulus: StimulusWire | undefined
  // The 0-based index of `question`'s group within `section.groups`, and
  // that group's full question list -- ReadingRunner's "Passage N ·
  // questions X-Y" needs both (N = groupIndex + 1, X/Y = the group's first
  // and last question ordinals). Unused by the listening branch; carried
  // here rather than recomputed by a second group lookup in the reading
  // branch below.
  readonly groupIndex: number
  readonly groupQuestions: readonly RunnerQuestion[]
}

function flattenSection(section: RunnerSection): FlatEntry[] {
  return section.groups.flatMap((group, groupIndex) =>
    group.questions.map((question) => ({
      question,
      stimulus: group.stimulus,
      groupIndex,
      groupQuestions: group.questions,
    })),
  )
}

type PlayState =
  | { readonly status: "idle" }
  | { readonly status: "granted"; readonly mediaUrl: string }
  // The granted media's own `<audio>` element fired `error` (Defect fix:
  // ListeningRunner previously had no `onError` at all, so a stalled or
  // failed load left `playing` -- and hence the play button -- stuck true
  // forever, with no way for the child to recover or even know why. The
  // play itself is NOT retried here: `POST /play` already counted it before
  // the browser ever started fetching, so this only clears `audioSrc` (the
  // failed element unmounts, `playing` goes back to false) and tells
  // ListeningRunner to show an honest message. A fresh tap on the play
  // button is a deliberate, ordinary new claim through `handleClaimPlay`,
  // exactly like any other replay.
  | { readonly status: "failed" }

interface ExpiredState {
  readonly kind: "section" | "attempt"
  readonly resultUrl: string | null
}

export interface RunScreenProps {
  readonly attemptId: string
  readonly envelope: RunnerEnvelope
  readonly queue: AnswerQueue
  readonly student?: MenuStudent
  readonly navigate: (path: string) => void
}

type RunnerPanel = "menu" | "navigator" | null

export function RunScreen({
  attemptId,
  envelope,
  queue,
  student,
  navigate,
}: RunScreenProps) {
  const { t } = useTranslation("runner")
  const section = envelope.currentSectionId
    ? envelope.sections.find(
        (candidate) => candidate.id === envelope.currentSectionId,
      )
    : undefined

  const entries = section ? flattenSection(section) : []
  const initialQuestionId =
    envelope.currentQuestionId ?? entries.at(0)?.question.id ?? null

  // Hooks are called on every render regardless of which branch below
  // returns -- the redirect/dispatch decisions happen entirely after these,
  // never between them, so this stays rules-of-hooks safe.
  const [currentQuestionId, setCurrentQuestionId] = useState(initialQuestionId)
  // A Map, not a Record: `packages/app/tsconfig.json` does not set
  // `noUncheckedIndexedAccess`, so `Record<string, T>[key]` types as `T`
  // (never `T | undefined`) and hides exactly the missing-key case this
  // state exists to represent. `Map#get` stays honestly `T | undefined`
  // either way.
  const [responses, setResponses] = useState<Map<string, string[]>>(
    () =>
      new Map(
        envelope.responses.map((response) => [
          response.questionId,
          response.selectedChoiceIds,
        ]),
      ),
  )
  const [playState, setPlayState] = useState<PlayState>({ status: "idle" })
  const [playsUsedByStimulusId, setPlaysUsedByStimulusId] = useState<
    Record<string, number>
  >({})
  const [expired, setExpired] = useState<ExpiredState | null>(null)
  const [panel, setPanel] = useState<RunnerPanel>(null)

  // Constructed once per mount, tied to this attempt's `queue` prop (opened
  // once by the route loader, not re-opened on every render) -- the lazy
  // initializer runs exactly once, on the first render, never again.
  const [controller] = useState(
    () => new FlushController(queue, apiFlushHttp, scheduler),
  )

  // A "latest value" ref rather than a dependency the pagehide effect below
  // re-subscribes on: `registerPagehideFlush` calls `getOpenSection()` live,
  // at the moment `pagehide` actually fires, so this only needs to be kept
  // current, never to trigger a re-registration when the question (and
  // hence, on a section boundary, `section`) changes.
  const openSectionRef = useRef<{
    attemptId: string
    sectionId: string
  } | null>(null)

  // Refs are read outside render (event handlers, effects); writing one
  // must live there too, never inline in the render body, so this update
  // runs as its own no-dependency-array effect -- after every render,
  // exactly the "keep it current" semantics the comment above promises.
  useEffect(() => {
    openSectionRef.current = section
      ? { attemptId, sectionId: section.id }
      : null
  })

  // Spec §5 rule 6, "Flush at end of life": a backgrounded/closed tab must
  // not lose whatever the queue is still holding for the open section. The
  // queue itself is closed here too -- on unmount, not per render -- since
  // this component owns the one open() call the loader made for it.
  useEffect(() => {
    const unregisterPagehideFlush = registerPagehideFlush(
      queue,
      () => openSectionRef.current,
      (id) => `/attempts/${id}/responses`,
    )

    return () => {
      unregisterPagehideFlush()
      void queue.close()
    }
  }, [queue])

  // "attempt exists but nothing entered yet" -- no section has ever been
  // entered, so every section is still `pending`. The first one in
  // ordinal order (the order the server returns them in) is the only
  // sensible target; there is no other data this envelope carries to pick
  // from.
  if (!envelope.currentSectionId || !section) {
    const firstSection = envelope.sections.at(0)

    if (firstSection) {
      navigate(`/attempts/${attemptId}/sections/${firstSection.id}/rules`)
    }

    return null
  }

  const foundIndex = entries.findIndex(
    (entry) => entry.question.id === currentQuestionId,
  )
  const currentIndex = foundIndex >= 0 ? foundIndex : 0
  const currentEntry = entries.at(currentIndex)

  if (!currentEntry) {
    return null
  }

  const { question, stimulus } = currentEntry
  const existingResponse = responses.get(question.id)
  const selectedChoiceIds = existingResponse ?? []
  // `allowAnswerChange: false` means "your answer is final once given". For
  // single_choice that is a single tap, so locking on the first selection is
  // exactly right. For multi_choice it is not: BUILDING the set is how the
  // question gets answered, and locking on the first checkbox would leave a
  // two-correct-answer question permanently half-answered -- and then graded
  // wrong, because isQuestionCorrect requires the set to match exactly.
  // So a multi_choice question locks on what the SERVER already had when
  // this screen loaded (a genuine earlier answer), never on the set the
  // child is assembling right now.
  const priorServerResponse = envelope.responses.find(
    (response) => response.questionId === question.id,
  )
  const answeredBefore =
    question.type === "multi_choice"
      ? (priorServerResponse?.selectedChoiceIds.length ?? 0) > 0
      : (existingResponse?.length ?? 0) > 0
  const locked = !section.allowAnswerChange && answeredBefore

  // Durable before sent (spec §5 rule 1): `queue.recordAnswer` writes to
  // IndexedDB -- surviving a tab close from this point on -- alongside the
  // optimistic `setResponses` update, before any network attempt is even
  // attempted. The flush that follows is fire-and-forget on purpose:
  // FlushController already owns retry/backoff internally, and awaiting it
  // here would make every tap wait on the network the queue exists to
  // route around.
  //
  // ChoiceList reports which choice the child just tapped, not the new
  // selection -- this is where that tap becomes a full selectedChoiceIds
  // array, because what it means depends on question.type: single_choice
  // replaces the selection (a fresh [choiceId], matching a RadioGroup's own
  // one-at-a-time semantics), multi_choice toggles that id in or out of the
  // existing set. isQuestionCorrect (@pp/common/scoring) grades multi_choice
  // by exact set equality, so every currently-selected id has to reach the
  // queue intact, not just the one that was last tapped.
  const nextChoiceIdsFor = (choiceId: string): string[] => {
    if (question.type !== "multi_choice") {
      return [choiceId]
    }

    return selectedChoiceIds.includes(choiceId)
      ? selectedChoiceIds.filter((id) => id !== choiceId)
      : [...selectedChoiceIds, choiceId]
  }

  const handleSelectChoice = (choiceId: string): void => {
    const nextChoiceIds = nextChoiceIdsFor(choiceId)

    setResponses((prev) => new Map(prev).set(question.id, nextChoiceIds))

    void queue
      .recordAnswer(
        {
          attemptId,
          sectionId: section.id,
          questionId: question.id,
          selectedChoiceIds: nextChoiceIds,
          timeSpentMs: null,
        },
        new Date(),
      )
      .then(() =>
        controller.flushSection(
          attemptId,
          section.id,
          `/attempts/${attemptId}/responses`,
        ),
      )
      .catch(() => {
        // Deliberately not re-thrown, and deliberately not surfaced as UI
        // state (unlike moveToQuestion/handleNavigatorNavigate's own
        // `.catch`, which react to `attempt_expired`/`section_expired`):
        // FlushController already owns retry/backoff internally (see the
        // "fire-and-forget on purpose" comment above), and the answer is
        // already durable in IndexedDB regardless of whether THIS flush
        // attempt succeeds -- the next one (the next tap, pagehide, or
        // hand-in) carries it. Only exists so a rejection here (including a
        // queue closed out from under an in-flight flush, e.g. on unmount)
        // is never left as an unhandled promise rejection.
      })
  }

  const handleClaimPlay = async (): Promise<void> => {
    if (!stimulus) {
      return
    }

    try {
      const grant = await claimPlay(attemptId, stimulus.id)

      setPlaysUsedByStimulusId((prev) => ({
        ...prev,
        [stimulus.id]: grant.playsUsed,
      }))
      setPlayState({ status: "granted", mediaUrl: grant.mediaUrl })
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error
      }

      if (error.problem.type === "section_expired") {
        setExpired({ kind: "section", resultUrl: null })

        return
      }

      if (error.problem.type === "attempt_expired" && error.problem.attempt) {
        const parsed = sameOriginPath.safeParse(error.problem.attempt.resultUrl)

        setExpired({
          kind: "attempt",
          resultUrl: parsed.success ? parsed.data : null,
        })

        return
      }

      // 409 (no plays remaining) or anything else unexpected: the play
      // simply did not happen. Reset so the button reflects that rather
      // than staying stuck mid-claim.
      setPlayState({ status: "idle" })
    }
  }

  const handleAudioEnded = (): void => {
    setPlayState({ status: "idle" })
  }

  const handleAudioError = (): void => {
    setPlayState({ status: "failed" })
  }

  const nextEntry = entries.at(currentIndex + 1)
  const previousEntry = entries.at(currentIndex - 1)

  // Shared by Next (both sections) and Previous (reading's `free` section
  // only -- listening's forward_only never renders a Previous button, see
  // ListeningRunner). `PUT /position` itself does not distinguish direction:
  // openapi.yaml's `navigation_locked` 409 only ever fires for a BACKWARD
  // move in a forward_only section (attempt.repository.ts), which this app
  // never attempts since it hides Previous there entirely. What CAN fire
  // regardless of direction or navigation mode is the same
  // SectionOrAttemptExpired 410 every other runner call uses -- surfaced
  // here exactly like handleClaimPlay does, so a student paging through a
  // reading passage after the section's clock has run out sees the same
  // actionable message rather than a click that silently does nothing.
  const moveToQuestion = (entry: FlatEntry): void => {
    setPosition(attemptId, section.id, entry.question.id)
      .then(() => {
        setCurrentQuestionId(entry.question.id)
        setPlayState({ status: "idle" })
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiError)) {
          throw error
        }

        if (error.problem.type === "section_expired") {
          setExpired({ kind: "section", resultUrl: null })

          return
        }

        if (error.problem.type === "attempt_expired" && error.problem.attempt) {
          const parsed = sameOriginPath.safeParse(
            error.problem.attempt.resultUrl,
          )

          setExpired({
            kind: "attempt",
            resultUrl: parsed.success ? parsed.data : null,
          })

          // Debounced/fire-and-forget for anything else (e.g. a stale
          // request racing a reload) per openapi.yaml -- losing one costs
          // a wrong landing spot after reload, nothing more.
        }
      })
  }

  const handleNext = (): void => {
    if (!nextEntry) {
      return
    }

    moveToQuestion(nextEntry)
  }

  const handlePrevious = (): void => {
    if (!previousEntry) {
      return
    }

    moveToQuestion(previousEntry)
  }

  const displayStimulus: StimulusWire | undefined =
    stimulus && "playsUsed" in stimulus
      ? {
          ...stimulus,
          playsUsed: playsUsedByStimulusId[stimulus.id] ?? stimulus.playsUsed,
        }
      : stimulus

  const pips = entries.map((entry) => ({
    questionId: entry.question.id,
    ordinal: entry.question.ordinal,
    current: entry.question.id === question.id,
  }))

  const navigatorSource: NavigatorSource = {
    mode: "runner",
    currentQuestionId: question.id,
    sections: envelope.sections.map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      navigation: candidate.navigation,
      status: candidate.status,
      questions: candidate.groups.flatMap((group) =>
        group.questions.map(({ id, ordinal }) => ({ id, ordinal })),
      ),
    })),
    answeredQuestionIds: new Set(responses.keys()),
  }

  const handleNavigatorNavigate = (
    targetSectionId: string,
    targetQuestionId: string,
  ): void => {
    const targetSection = envelope.sections.find(
      (candidate) => candidate.id === targetSectionId,
    )
    const targetEntry = targetSection
      ? flattenSection(targetSection).find(
          (entry) => entry.question.id === targetQuestionId,
        )
      : undefined

    // This repeats the server-backed disabled rule at the write boundary.
    // A presentational regression must not turn a disabled cell into a PUT
    // the server refuses.
    if (
      !targetSection ||
      !targetEntry ||
      targetSection.status !== "open" ||
      targetSection.navigation !== "free"
    ) {
      return
    }

    setPosition(attemptId, targetSection.id, targetEntry.question.id)
      .then(() => {
        setCurrentQuestionId(targetEntry.question.id)
        setPlayState({ status: "idle" })
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiError)) {
          throw error
        }

        if (error.problem.type === "section_expired") {
          setExpired({ kind: "section", resultUrl: null })

          return
        }

        if (error.problem.type === "attempt_expired" && error.problem.attempt) {
          const parsed = sameOriginPath.safeParse(
            error.problem.attempt.resultUrl,
          )

          setExpired({
            kind: "attempt",
            resultUrl: parsed.success ? parsed.data : null,
          })
        }
      })
    setPanel(null)
  }

  let runner: JSX.Element | null = null

  if (section.type === "listening") {
    runner = (
      <ListeningRunner
        question={question}
        stimulus={displayStimulus}
        selectedChoiceIds={selectedChoiceIds}
        locked={locked}
        onSelectChoice={handleSelectChoice}
        onClaimPlay={handleClaimPlay}
        audioSrc={playState.status === "granted" ? playState.mediaUrl : null}
        onAudioEnded={handleAudioEnded}
        onAudioError={handleAudioError}
        audioFailed={playState.status === "failed"}
        questionCount={envelope.questionCount}
        pips={pips}
        hasNext={Boolean(nextEntry)}
        onNext={handleNext}
        expired={expired}
        onHandIn={() => {
          // Plan 5 gave hand-in a route; before that ReadingRunner's button
          // was deliberately inert with a "not yet" title. Navigation lives
          // here rather than in the component because `components/` is
          // stateless by policy.
          navigate(`/attempts/${attemptId}/hand-in`)
        }}
      />
    )
  } else if (section.type === "reading") {
    runner = (
      <ReadingRunner
        question={question}
        stimulus={displayStimulus}
        passageOrdinal={currentEntry.groupIndex + 1}
        passageFirstOrdinal={
          currentEntry.groupQuestions.at(0)?.ordinal ?? question.ordinal
        }
        passageLastOrdinal={
          currentEntry.groupQuestions.at(-1)?.ordinal ?? question.ordinal
        }
        selectedChoiceIds={selectedChoiceIds}
        locked={locked}
        onSelectChoice={handleSelectChoice}
        questionCount={envelope.questionCount}
        pips={pips}
        hasPrevious={Boolean(previousEntry)}
        onPrevious={handlePrevious}
        hasNext={Boolean(nextEntry)}
        onNext={handleNext}
        expired={expired}
        onHandIn={() => {
          // Plan 5 gave hand-in a route; before that ReadingRunner's button
          // was deliberately inert with a "not yet" title. Navigation lives
          // here rather than in the component because `components/` is
          // stateless by policy.
          navigate(`/attempts/${attemptId}/hand-in`)
        }}
      />
    )
  } else {
    // No runner is built yet for the remaining section types (vocabulary,
    // grammar) -- out of scope for this plan.
    return null
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="relative z-[60] flex items-center justify-between border-b border-stone-200 bg-white px-3 py-2">
        <button
          type="button"
          aria-label={t("menu.openLabel")}
          aria-expanded={panel === "menu"}
          className="size-11 touch-manipulation rounded-md text-xl font-bold select-none hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          onClick={() => {
            setPanel((current) => (current === "menu" ? null : "menu"))
          }}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-800">
          {t(`runner.sectionChip.${section.type}`)}
        </span>
      </header>

      <div>{runner}</div>

      <nav className="relative z-[60] flex justify-end border-t border-stone-200 bg-white px-3 py-2">
        <button
          type="button"
          aria-label={t("navigator.openLabel")}
          aria-expanded={panel === "navigator"}
          className="size-11 touch-manipulation rounded-md text-xl font-bold select-none hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          onClick={() => {
            setPanel((current) =>
              current === "navigator" ? null : "navigator",
            )
          }}
        >
          <span aria-hidden="true">▦</span>
        </button>
      </nav>

      <AppMenu
        open={panel === "menu"}
        onOpenChange={(next) => {
          // Radix requests closing for Escape, overlay and close-button
          // interactions. Opening is exclusively driven by our triggers.
          // Only close if this is still the active panel: a delayed dismiss
          // from the menu must not clobber a direct switch to the navigator.
          if (!next) {
            setPanel((current) => (current === "menu" ? null : current))
          }
        }}
        inTest
        // The attempt's clock does not start with the attempt: openapi.yaml
        // is explicit that `startedAt` and `expiresAt` "stay null until the
        // first section entry". Hardcoding this told a child "the clock
        // keeps running while you are away" before they had started
        // anything -- false, and exactly the sort of thing that would stop
        // a child leaving a test they had not begun.
        clockStarted={envelope.expiresAt !== null}
        student={student}
        onGoLibrary={() => {
          navigate("/")
        }}
        onGoHistory={() => {
          navigate("/history")
        }}
        onLeaveTest={() => {
          navigate("/")
        }}
        onSignOut={() => {
          navigate("/")
        }}
      />
      <QuestionNavigator
        open={panel === "navigator"}
        onOpenChange={(next) => {
          // See AppMenu's matching guards: Sheet never owns the open action,
          // and a stale close must not dismiss the newly selected panel.
          if (!next) {
            setPanel((current) => (current === "navigator" ? null : current))
          }
        }}
        source={navigatorSource}
        answeredCount={responses.size}
        totalCount={envelope.questionCount}
        onNavigate={handleNavigatorNavigate}
      />
    </div>
  )
}

/**
 * The envelope is required; the identity is not.
 *
 * `GET /me` 404s when no profile exists for this `sub` yet -- the contract
 * says "call `POST /session` first", which is the ordinary state of a fresh
 * install rather than an error. So a failed identity fetch must leave the
 * child able to sit the test with an unnamed menu, never block the runner
 * from loading. Exported so that promise is testable directly, instead of
 * being reachable only through the router.
 */
export async function loadRunScreenData(attemptId: string): Promise<{
  envelope: RunnerEnvelope
  student: MenuStudent | undefined
}> {
  const [envelope, student] = await Promise.all([
    getRunnerEnvelope(attemptId),
    getCurrentStudent().catch(() => undefined),
  ])

  return { envelope, student }
}

/**
 * The route loader proper: `loadRunScreenData`'s envelope+identity plus the
 * queue, opened once per route entry (not inside the component, so a
 * re-render never reopens it) -- and the 410 attempt_expired redirect
 * described on `RunRouteError` below. Exported, like `loadRunScreenData`,
 * so the redirect is testable directly rather than only reachable through
 * the router (mirrors `attempts.$attemptId.result.tsx`'s `loadResult`).
 */
export async function loadRunRouteData(attemptId: string): Promise<{
  envelope: RunnerEnvelope
  student: MenuStudent | undefined
  queue: AnswerQueue
}> {
  try {
    const [{ envelope, student }, queue] = await Promise.all([
      loadRunScreenData(attemptId),
      AnswerQueue.open(),
    ])

    return { envelope, student, queue }
  } catch (error) {
    // A 410 attempt_expired here means THIS load finalized the attempt --
    // the honest destination is the result screen it names, not an error
    // page for a request that actually succeeded at what it was for
    // (finding out the attempt is over). Every other failure (a network
    // blip, 401/403, a blocked IndexedDB open) falls through to
    // RunRouteError below.
    redirectExpiredAttemptToResult(error)

    throw error
  }
}

/**
 * The runner screen has no default TanStack error page to fall back on --
 * this is one of the two screens (with hand-in.tsx) live during a timed
 * test, so a bare "something went wrong" with no way back would leave a
 * child staring at a dead end while their clock keeps running. Honest on
 * both fronts the fallback page cannot be: every answer is durably queued
 * in IndexedDB (`lib/answerQueue.ts`) BEFORE it is ever sent, and reloading
 * this route re-runs the loader without touching that queue at all -- so
 * "try again" here costs nothing that was not already lost by the network
 * blip that brought the loader down in the first place.
 */
export interface RunRouteErrorProps {
  readonly error: unknown
}

export function RunRouteError(_props: RunRouteErrorProps) {
  const { t } = useTranslation("runner")

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>{t("runError.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="alert">{t("runError.message")}</p>
          <Button
            className="h-11 min-w-11 touch-manipulation select-none"
            onClick={() => {
              window.location.reload()
            }}
          >
            {t("runError.retry")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute("/attempts/$attemptId/run")({
  loader: ({ params }) => loadRunRouteData(params.attemptId),
  errorComponent: RunRouteError,
  component: RouteComponent,
})

function RouteComponent() {
  const { attemptId } = Route.useParams()
  const { envelope, student, queue } = Route.useLoaderData()

  // Same stand-in as sections.$sectionId.rules.tsx: no typed route exists
  // yet for the section-rules destination from here without inventing its
  // contract early.
  const navigate = (path: string): void => {
    window.location.assign(path)
  }

  return (
    <RunScreen
      attemptId={attemptId}
      envelope={envelope}
      queue={queue}
      student={student}
      navigate={navigate}
    />
  )
}
