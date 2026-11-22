import { Card, CardContent } from "@liam-workspace/browser-react-ui"
import { Link, createFileRoute, redirect } from "@tanstack/react-router"
import type { CSSProperties } from "react"
import { useTranslation } from "react-i18next"
import { ApiError } from "../lib/api-client.js"
import type { AttemptResult, AttemptSectionScore } from "../lib/api-types.js"
import { Icon, type IconName } from "../components/Icon.js"
import { getAttemptResult } from "../lib/attempts-api.js"

export async function loadResult(attemptId: string): Promise<AttemptResult> {
  try {
    return await getAttemptResult(attemptId)
  } catch (error: unknown) {
    if (error instanceof ApiError && error.problem.status === 409) {
      redirect({
        href: `/attempts/${attemptId}/run`,
        replace: true,
        throw: true,
      })

      throw new Error("TanStack Router did not throw its redirect")
    }

    throw error
  }
}

const SECTION_ICON: Record<AttemptSectionScore["type"], IconName> = {
  listening: "headphones",
  reading: "book",
  math: "calc",
  vocabulary: "book",
  grammar: "book",
}

function headlineKey(percentage: number): string {
  if (percentage >= 80) {
    return "result.headline"
  }

  return percentage >= 50 ? "result.headlineGood" : "result.headlineKeepGoing"
}

export interface ResultScreenProps {
  readonly result: AttemptResult
}

export function ResultScreen({ result }: ResultScreenProps) {
  const { i18n, t } = useTranslation("runner")
  const { score } = result
  const percentage = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 2,
  }).format(score.percentage)
  const ringPercentage = Math.max(0, Math.min(100, score.percentage))
  const ringStyle = {
    "--score-pct": `${ringPercentage}%`,
    background:
      "conic-gradient(var(--color-teal) 0 var(--score-pct), var(--color-line) 0)",
  } as CSSProperties

  return (
    <div className="m-page">
      <header className="m-appbar">
        <Link
          to="/"
          className="m-iconbtn"
          aria-label={t("result.backToLibrary")}
        >
          <Icon name="back" />
        </Link>
        <span className="m-brand">{t("result.scoreLabel")}</span>
      </header>

      <main className="m-body text-center">
        <p className="m-eyebrow">
          {result.test.title}
          {result.status === "expired"
            ? ` · ${t("history.status.expired")}`
            : ""}
        </p>
        <h1 className="m-title mt-1" tabIndex={-1} data-page-title>
          {t(headlineKey(score.percentage))}
        </h1>
        <div
          data-testid="score-ring"
          className="score-ring mx-auto my-3"
          style={ringStyle}
          aria-label={t("result.scoreLabel")}
        >
          <div>
            <div className="leading-tight">
              <p className="text-ink text-[38px] font-extrabold tabular-nums">
                {t("result.percentage", { percentage })}
              </p>
              <p className="text-ink-2 text-[13px] font-bold tabular-nums">
                {t("result.fraction", {
                  earned: score.pointsEarned,
                  possible: score.pointsPossible,
                })}
              </p>
            </div>
          </div>
        </div>
        {score.isPersonalBest ? (
          <p>
            <span className="m-chip" data-tone="good">
              <Icon name="check" small /> {t("result.personalBest")}
            </span>
          </p>
        ) : null}
        <p className="m-sub mt-2">
          {t("result.summary", {
            answered: score.answered,
            correct: score.correct,
            incorrect: score.incorrect,
            unanswered: score.unanswered,
          })}
        </p>
        <div className="mt-3.5 grid gap-2 text-left">
          {score.sections.map((section) => (
            <div
              key={`${section.type}-${section.title}`}
              data-testid="breakdown-row"
              data-section-type={section.type}
              className="m-card flex items-center gap-2.5 py-2.5 font-bold"
            >
              <Icon name={SECTION_ICON[section.type]} />
              <span>{section.title}</span>
              <span className="ml-auto tabular-nums">
                {t("result.fraction", {
                  earned: section.pointsEarned,
                  possible: section.pointsPossible,
                })}
              </span>
            </div>
          ))}
        </div>
        <p className="m-reason mt-3.5">
          {t("result.practiceNotice", {
            title: result.test.title,
            version: result.test.version,
          })}
        </p>
      </main>

      <footer className="m-actionbar" data-sticky="true">
        <Link className="m-btn" data-variant="secondary" to="/">
          {t("result.backToLibrary")}
        </Link>
        <a className="m-btn" href={`/attempts/${result.attemptId}/review`}>
          {t("result.reviewAnswers")}
        </a>
      </footer>
    </div>
  )
}

export interface ResultRouteErrorProps {
  readonly error: unknown
}

export function ResultRouteError({ error }: ResultRouteErrorProps) {
  const { t } = useTranslation("runner")
  const forbidden = error instanceof ApiError && error.problem.status === 403

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <Card>
        <CardContent>
          <p role="alert">
            {t(forbidden ? "result.forbidden" : "result.error")}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute("/attempts/$attemptId/result")({
  loader: ({ params }) => loadResult(params.attemptId),
  errorComponent: ResultRouteError,
  component: RouteComponent,
})

function RouteComponent() {
  const result = Route.useLoaderData()

  return <ResultScreen result={result} />
}
