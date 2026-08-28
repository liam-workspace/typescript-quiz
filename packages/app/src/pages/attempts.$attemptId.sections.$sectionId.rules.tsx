import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@liam-public/browser-react-ui"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { ApiError } from "../lib/api-client.js"
import { enterSection, getRunnerEnvelope } from "../lib/attempts-api.js"
import { sameOriginPath } from "../lib/same-origin-path.js"
import type { FinalizedAttempt } from "../lib/api-types.js"

// The section-rules screen ("secintro" in the prototype) is the last thing a
// student sees before the clock starts: `POST .../enter` is what sets
// `startedAt`/`expiresAt` (openapi.yaml:325-361). Reading the rules is
// untimed by design, so `enterSection` MUST fire only from the "I'm ready"
// click -- never from a loader or an effect on mount, or the student would
// be charged time they spent reading.
//
// `finalizedPriorAttempt` is news the test-brief/attempt-start screen already
// has client side from `POST /attempts`, so this route carries it in validated
// search state. The section's rules and authoritative attempt number come
// from the canonical runner envelope, without inventing a call to
// `enterSection` just to get something to render.

const finalizedPriorAttemptSearchSchema = z
  .object({
    id: z.string(),
    status: z.literal("expired"),
    submittedAt: z.string(),
    // Straight out of the URL bar -- the attacker-controlled half of the two
    // sources this module's docstring names. Guarded here so the render site
    // below cannot be the thing that has to remember.
    resultUrl: sameOriginPath,
  })
  .nullable()

export const searchSchema = z.object({
  title: z.string().default(""),
  instructions: z.array(z.string()).default([]),
  finalizedPriorAttempt: finalizedPriorAttemptSearchSchema.default(null),
})

export type SectionRulesSearch = z.infer<typeof searchSchema>

type EnterOutcome =
  | { readonly status: "idle" }
  | { readonly status: "entering" }
  | { readonly status: "refused"; readonly problem: ApiError["problem"] }
  | { readonly status: "sectionExpired" }
  | { readonly status: "attemptExpired"; readonly resultUrl: string | null }

export interface SectionRulesScreenProps {
  readonly attemptId: string
  readonly sectionId: string
  readonly sectionType: "listening" | "reading" | "vocabulary" | "grammar"
  readonly title: string
  readonly testTitle: string
  readonly attemptNumber: number
  readonly questionCount: number
  readonly durationSeconds: number
  readonly instructions: readonly string[]
  readonly finalizedPriorAttempt: FinalizedAttempt | null
  readonly navigate: (path: string) => void
}

export function SectionRulesScreen({
  attemptId,
  sectionId,
  sectionType,
  title,
  testTitle,
  attemptNumber,
  questionCount,
  durationSeconds,
  instructions,
  finalizedPriorAttempt,
  navigate,
}: SectionRulesScreenProps) {
  const { t } = useTranslation("runner")
  const [outcome, setOutcome] = useState<EnterOutcome>({ status: "idle" })
  const durationMinutes = Math.round(durationSeconds / 60)

  const handleReady = (): void => {
    setOutcome({ status: "entering" })

    enterSection(attemptId, sectionId)
      .then(() => {
        navigate(`/attempts/${attemptId}/run`)
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiError)) {
          throw error
        }

        if (error.problem.type === "attempt_expired" && error.problem.attempt) {
          const resultUrl = sameOriginPath.safeParse(
            error.problem.attempt.resultUrl,
          )

          setOutcome({
            status: "attemptExpired",
            resultUrl: resultUrl.success ? resultUrl.data : null,
          })

          return
        }

        if (error.problem.type === "section_expired") {
          setOutcome({ status: "sectionExpired" })

          return
        }

        setOutcome({ status: "refused", problem: error.problem })
      })
  }

  if (
    outcome.status === "sectionExpired" ||
    outcome.status === "attemptExpired"
  ) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("sectionRules.expired.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            {outcome.status === "attemptExpired"
              ? t("sectionRules.expired.attemptMessage")
              : t("sectionRules.expired.sectionMessage")}
          </p>
          {outcome.status === "attemptExpired" && outcome.resultUrl ? (
            <a href={outcome.resultUrl}>
              {t("sectionRules.expired.viewResult")}
            </a>
          ) : null}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="bg-surface text-ink min-h-screen">
      <header className="border-line bg-paper flex items-center justify-between border-b px-4 py-3">
        <span className="bg-teal-bg text-teal rounded-full px-3 py-1 text-xs font-bold">
          {t(`runner.sectionChip.${sectionType}`)}
        </span>
        <span className="text-ink-2 text-xs font-bold">
          {t("sectionRules.durationBeforeStart", {
            minutes: durationMinutes,
          })}
        </span>
      </header>
      <main className="mx-auto max-w-xl px-4 py-8">
        <p className="text-faint mb-1 text-xs font-bold tracking-wider uppercase">
          {t("sectionRules.attemptEyebrow", {
            testTitle,
            number: attemptNumber,
          })}
        </p>
        {finalizedPriorAttempt ? (
          <p>
            {t("sectionRules.finalizedPriorAttempt.notice")}{" "}
            <a href={finalizedPriorAttempt.resultUrl}>
              {t("sectionRules.finalizedPriorAttempt.viewLink")}
            </a>
          </p>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-ink-2">
              {t("sectionRules.questionDuration", {
                count: questionCount,
                minutes: durationMinutes,
              })}
            </p>
            <p>{t("sectionRules.beforeYouBegin")}</p>
            <ul>
              {instructions.map((instruction) => (
                <li key={instruction}>{instruction}</li>
              ))}
            </ul>
            {outcome.status === "refused" ? (
              <p role="alert">{refusalMessage(outcome.problem.type, t)}</p>
            ) : null}
          </CardContent>
        </Card>
        <Button
          className="h-11 min-w-11 touch-manipulation select-none"
          data-testid="ready-button"
          onClick={handleReady}
          disabled={outcome.status === "entering"}
        >
          {t("sectionRules.readyButton")}
        </Button>
      </main>
    </div>
  )
}

export async function loadSectionRulesData(
  attemptId: string,
  sectionId: string,
): Promise<
  Omit<SectionRulesScreenProps, "navigate" | "finalizedPriorAttempt">
> {
  const envelope = await getRunnerEnvelope(attemptId)
  const section = envelope.sections.find(
    (candidate) => candidate.id === sectionId,
  )

  if (!section) {
    throw new Error(
      `section ${sectionId} does not belong to attempt ${attemptId}`,
    )
  }

  return {
    attemptId,
    sectionId,
    sectionType: section.type,
    title: section.title,
    testTitle: envelope.testTitle,
    attemptNumber: envelope.attemptNumber,
    questionCount: section.questionCount,
    durationSeconds: section.durationSeconds,
    instructions: section.instructions,
  }
}

function refusalMessage(
  problemType: string,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (problemType === "section_still_open") {
    return t("sectionRules.error.previousSectionOpen")
  }

  return t("sectionRules.error.generic")
}

export const Route = createFileRoute(
  "/attempts/$attemptId/sections/$sectionId/rules",
)({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, params }) => ({
    ...(await loadSectionRulesData(params.attemptId, params.sectionId)),
    finalizedPriorAttempt: deps.finalizedPriorAttempt,
  }),
  component: RouteComponent,
})

function RouteComponent() {
  const { attemptId, sectionId } = Route.useParams()
  const data = Route.useLoaderData()

  // No `/attempts/$attemptId/run` route exists in this codebase yet (a later
  // task in this plan builds it), so it cannot be a typed `navigate({ to })`
  // target here without inventing that route's contract early. A full
  // navigation is the correct, honest stand-in until that route lands --
  // whoever builds it should switch this to the router's typed `navigate`.
  const navigate = (path: string): void => {
    window.location.assign(path)
  }

  return (
    <SectionRulesScreen
      {...data}
      attemptId={attemptId}
      sectionId={sectionId}
      navigate={navigate}
    />
  )
}
