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
      <div className="device-page">
        <main className="center-main">
          <section className="device-card max-w-xl">
            <h1 className="screen-title">{t("sectionRules.expired.title")}</h1>
            <p>
              {outcome.status === "attemptExpired"
                ? t("sectionRules.expired.attemptMessage")
                : t("sectionRules.expired.sectionMessage")}
            </p>
            {outcome.status === "attemptExpired" && outcome.resultUrl ? (
              <a
                href={outcome.resultUrl}
                className="device-button mt-4"
                data-variant="secondary"
              >
                {t("sectionRules.expired.viewResult")}
              </a>
            ) : null}
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="device-page">
      <header className="app-bar">
        <span
          className={`section-chip section-chip--${sectionType}`}
          data-section-type={sectionType}
        >
          {t(`runner.sectionChip.${sectionType}`)}
        </span>
        <span className="grow" />
        <span className="text-ink-2 text-[12.5px] font-bold">
          {t("sectionRules.durationBeforeStart", {
            minutes: durationMinutes,
          })}
        </span>
      </header>
      <main className="center-main">
        <p className="text-faint mb-1 text-[12.5px] font-bold tracking-[0.05em] uppercase">
          {t("sectionRules.attemptEyebrow", {
            testTitle,
            number: attemptNumber,
          })}
        </p>
        <h1 className="screen-title">{title}</h1>
        <p className="screen-subtitle max-w-[40ch]">
          {t("sectionRules.questionDuration", {
            count: questionCount,
            minutes: durationMinutes,
          })}
        </p>
        {finalizedPriorAttempt ? (
          <p className="border-amber bg-amber/15 text-ink-2 mt-[14px] max-w-[430px] rounded-[9px] border px-[14px] py-[11px] text-left text-[13.5px] font-semibold">
            {t("sectionRules.finalizedPriorAttempt.notice")}{" "}
            <a
              href={finalizedPriorAttempt.resultUrl}
              className="text-ink underline underline-offset-4"
            >
              {t("sectionRules.finalizedPriorAttempt.viewLink")}
            </a>
          </p>
        ) : null}
        <section className="device-card mt-[16px] w-full max-w-[400px] text-left">
          <h2 className="mb-[9px] text-sm font-extrabold">
            {t("sectionRules.beforeYouBegin")}
          </h2>
          <ul className="text-ink-2 m-0 list-disc space-y-1 pl-[19px] text-sm leading-[1.75]">
            {instructions.map((instruction) => (
              <li key={instruction}>{instruction}</li>
            ))}
          </ul>
          {outcome.status === "refused" ? (
            <p role="alert" className="text-bad mt-3 text-sm font-semibold">
              {refusalMessage(outcome.problem.type, t)}
            </p>
          ) : null}
        </section>
        <button
          type="button"
          className="device-button mt-[18px]"
          data-testid="ready-button"
          onClick={handleReady}
          disabled={outcome.status === "entering"}
        >
          {t("sectionRules.readyButton")}
        </button>
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
