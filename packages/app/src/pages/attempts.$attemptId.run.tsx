import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { ListeningRunner } from "../components/ListeningRunner.js"
import { ReadingRunner } from "../components/ReadingRunner.js"
import { ApiError } from "../lib/api-client.js"
import {
  claimPlay,
  getRunnerEnvelope,
  setPosition,
} from "../lib/attempts-api.js"
import { sameOriginPath } from "../lib/same-origin-path.js"
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
// in-flight (unsent -- PHASE 4 boundary) answer selections, the claimed
// audio URL, and the expired-audio state that Tasks 8 and 9 each correctly
// declined (see ListeningRunner's ListeningExpiredState doc comment).

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

interface ExpiredState {
  readonly kind: "section" | "attempt"
  readonly resultUrl: string | null
}

export interface RunScreenProps {
  readonly attemptId: string
  readonly envelope: RunnerEnvelope
  readonly navigate: (path: string) => void
}

export function RunScreen({ attemptId, envelope, navigate }: RunScreenProps) {
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
  const selectedChoiceId = existingResponse?.[0] ?? null
  const locked =
    !section.allowAnswerChange && (existingResponse?.length ?? 0) > 0

  const handleSelectChoice = (choiceId: string): void => {
    setResponses((prev) => new Map(prev).set(question.id, [choiceId]))
    // PHASE 4: a save-response call (`PUT /attempts/{id}/responses/{questionId}`)
    // belongs here. Deliberately absent -- a selection is held in local
    // state only until that phase lands; see the test asserting no network
    // call fires on select.
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

  if (section.type === "listening") {
    return (
      <ListeningRunner
        question={question}
        stimulus={displayStimulus}
        selectedChoiceId={selectedChoiceId}
        locked={locked}
        onSelectChoice={handleSelectChoice}
        onClaimPlay={handleClaimPlay}
        audioSrc={playState.status === "granted" ? playState.mediaUrl : null}
        onAudioEnded={handleAudioEnded}
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
  }

  if (section.type === "reading") {
    return (
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
        selectedChoiceId={selectedChoiceId}
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
  }

  // No runner is built yet for the remaining section types (vocabulary,
  // grammar) -- out of scope for this plan.
  return null
}

export const Route = createFileRoute("/attempts/$attemptId/run")({
  loader: async ({ params }) => ({
    envelope: await getRunnerEnvelope(params.attemptId),
  }),
  component: RouteComponent,
})

function RouteComponent() {
  const { attemptId } = Route.useParams()
  const { envelope } = Route.useLoaderData()

  // Same stand-in as sections.$sectionId.rules.tsx: no typed route exists
  // yet for the section-rules destination from here without inventing its
  // contract early.
  const navigate = (path: string): void => {
    window.location.assign(path)
  }

  return (
    <RunScreen attemptId={attemptId} envelope={envelope} navigate={navigate} />
  )
}
