import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { Icon } from "../components/Icon.js"
import { ApiError } from "../lib/api-client.js"
import type { AttemptGateway } from "../lib/attempt/attempt-gateway.js"
import { attemptGateway } from "../lib/attempt/gateway-selector.js"
import { sameOriginPath } from "../lib/same-origin-path.js"
import type { FinalizedAttempt, SectionType } from "../lib/api-types.js"

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
  /** No refusal: the call never completed (no network, a full disk). */
  | { readonly status: "failed" }
  | { readonly status: "sectionExpired" }
  | { readonly status: "attemptExpired"; readonly resultUrl: string | null }

export interface SectionRulesScreenProps {
  readonly attemptId: string
  readonly sectionId: string
  readonly sectionType: SectionType
  readonly title: string
  readonly testTitle: string
  readonly attemptNumber: number
  readonly questionCount: number
  readonly durationSeconds: number
  readonly instructions: readonly string[]
  readonly sectionNumber: number
  readonly sectionTotal: number
  readonly finalizedPriorAttempt: FinalizedAttempt | null
  readonly navigate: (path: string) => void
  /** Defaults to the app-wide `attemptGateway`; tests inject a fake. */
  readonly gateway?: AttemptGateway
}

export function SectionRulesScreen({
  attemptId,
  sectionId,
  sectionType,
  testTitle,
  attemptNumber,
  questionCount,
  durationSeconds,
  instructions,
  sectionNumber,
  sectionTotal,
  finalizedPriorAttempt,
  navigate,
  gateway = attemptGateway,
}: SectionRulesScreenProps) {
  const { t } = useTranslation("runner")
  const [outcome, setOutcome] = useState<EnterOutcome>({ status: "idle" })
  const durationMinutes = Math.round(durationSeconds / 60)

  const handleReady = (): void => {
    setOutcome({ status: "entering" })

    gateway
      .enterSection(attemptId, sectionId)
      .then(() => {
        navigate(`/attempts/${attemptId}/run`)
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiError)) {
          // An OfflineError (nothing saved to enter offline), a storage
          // failure, a dead network: rethrowing left the button stuck on
          // "Starting…" with nothing said. Show the generic error; the
          // button is the retry.
          setOutcome({ status: "failed" })

          return
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
      <div className="m-page">
        <main className="m-hero">
          <div className="m-logo" data-tone="clay" aria-hidden="true">
            <Icon name="clock" />
          </div>
          <h1 className="m-title" tabIndex={-1} data-page-title>
            {t("sectionRules.expired.title")}
          </h1>
          <p className="m-sub">
            {outcome.status === "attemptExpired"
              ? t("sectionRules.expired.attemptMessage")
              : t("sectionRules.expired.sectionMessage")}
          </p>
          {outcome.status === "attemptExpired" && outcome.resultUrl ? (
            <a href={outcome.resultUrl} className="m-btn" data-block="true">
              {t("sectionRules.expired.viewResult")}
            </a>
          ) : null}
        </main>
      </div>
    )
  }

  const entering = outcome.status === "entering"
  const sectionLabel = t(`runner.sectionChip.${sectionType}`)

  return (
    <div className="m-page">
      <header className="m-appbar">
        <a href="/" className="m-iconbtn" aria-label={t("sectionRules.leave")}>
          <Icon name="back" />
        </a>
        <span className="m-brand">{t("library.brand")}</span>
        <span className="grow" />
        <span
          className={`section-chip section-chip--${sectionType}`}
          data-section-type={sectionType}
        >
          {sectionLabel}
        </span>
      </header>
      <main className="m-body">
        <p className="m-eyebrow">
          {t("sectionRules.attemptEyebrow", {
            testTitle,
            number: attemptNumber,
          })}
        </p>
        <h1 className="m-title mt-1" tabIndex={-1} data-page-title>
          {t("sectionRules.heading", { section: sectionLabel })}
        </h1>
        <p className="m-sub">
          {t("sectionRules.questionDuration", {
            count: questionCount,
            minutes: durationMinutes,
          })}
          {sectionTotal > 1
            ? ` · ${t("sectionRules.sectionPosition", {
                current: sectionNumber,
                total: sectionTotal,
              })}`
            : null}
        </p>
        {finalizedPriorAttempt ? (
          <p className="m-notice">
            {t("sectionRules.finalizedPriorAttempt.notice")}{" "}
            <a
              href={finalizedPriorAttempt.resultUrl}
              className="text-ink underline underline-offset-4"
            >
              {t("sectionRules.finalizedPriorAttempt.viewLink")}
            </a>
          </p>
        ) : null}
        <ul className="m-rules">
          {instructions.map((instruction) => (
            <li key={instruction}>
              <Icon
                name={sectionType === "listening" ? "headphones" : "check"}
              />
              <span>{instruction}</span>
            </li>
          ))}
        </ul>
        {outcome.status === "refused" || outcome.status === "failed" ? (
          <p role="alert" className="m-alert mt-3">
            {refusalMessage(
              outcome.status === "refused" ? outcome.problem.type : null,
              t,
            )}
          </p>
        ) : null}
        <p className="m-reason mt-3.5">
          {t(
            sectionNumber <= 1
              ? "sectionRules.clockNoteFirst"
              : "sectionRules.clockNoteNext",
          )}
        </p>
      </main>
      <div className="m-actionbar" data-sticky="true">
        <a
          href="/"
          className="m-btn"
          data-variant="secondary"
          style={{ flex: "0 0 auto" }}
        >
          {t("sectionRules.leave")}
        </a>
        <button
          type="button"
          className="m-btn"
          data-testid="ready-button"
          onClick={handleReady}
          disabled={entering}
          aria-busy={entering}
        >
          {t(entering ? "sectionRules.starting" : "sectionRules.readyButton")}
        </button>
      </div>
    </div>
  )
}

export async function loadSectionRulesData(
  attemptId: string,
  sectionId: string,
): Promise<
  Omit<
    SectionRulesScreenProps,
    "navigate" | "finalizedPriorAttempt" | "gateway"
  >
> {
  const envelope = await attemptGateway.loadEnvelope(attemptId)
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
    sectionNumber:
      envelope.sections.findIndex((candidate) => candidate.id === sectionId) +
      1,
    sectionTotal: envelope.sections.length,
  }
}

function refusalMessage(
  problemType: string | null,
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
