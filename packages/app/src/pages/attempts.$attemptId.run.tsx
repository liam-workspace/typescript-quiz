import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { ListeningRunner } from "../components/ListeningRunner.js"
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
}

function flattenSection(section: RunnerSection): FlatEntry[] {
  return section.groups.flatMap((group) =>
    group.questions.map((question) => ({ question, stimulus: group.stimulus })),
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

  const handleNext = (): void => {
    if (!nextEntry) {
      return
    }

    setPosition(attemptId, section.id, nextEntry.question.id)
      .then(() => {
        setCurrentQuestionId(nextEntry.question.id)
        setPlayState({ status: "idle" })
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiError)) {
          throw error
        }
        // Debounced/fire-and-forget per openapi.yaml -- losing one costs a
        // wrong landing spot after reload, nothing more. A forward move in
        // a forward_only section is accepted by the server (only a
        // BACKWARD move gets 409 navigation_locked), so this branch is not
        // expected to fire for the Next button; it exists so a genuine
        // 410 section/attempt expiry does not surface as an unhandled
        // rejection.
      })
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
      />
    )
  }

  // ReadingRunner (Task 11) is not built yet.
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
