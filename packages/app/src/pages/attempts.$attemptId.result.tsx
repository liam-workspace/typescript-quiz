import { Card, CardContent } from "@liam-workspace/browser-react-ui"
import { Link, createFileRoute, redirect } from "@tanstack/react-router"
import type { CSSProperties } from "react"
import { useTranslation } from "react-i18next"
import { ApiError } from "../lib/api-client.js"
import type { AttemptResult, AttemptSectionScore } from "../lib/api-types.js"
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

function scorePercentage(section: AttemptSectionScore): number {
  if (section.pointsPossible <= 0) {
    return 0
  }

  return Math.max(
    0,
    Math.min(100, (section.pointsEarned / section.pointsPossible) * 100),
  )
}

function sectionBarColour(type: AttemptSectionScore["type"]): string {
  switch (type) {
    case "listening":
      return "bg-teal"

    case "reading":
      return "bg-clay"

    case "vocabulary":
      return "bg-good"

    case "grammar":
      return "bg-amber"
  }
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
    <div className="device-page">
      <header className="app-bar">
        <span className="app-brand">{result.test.title}</span>
      </header>

      <main className="device-main mx-auto grid w-full max-w-4xl flex-1 content-start gap-6">
        <div className="flex flex-wrap items-center gap-6">
          <div
            data-testid="score-ring"
            className="score-ring mx-auto shrink-0 sm:mx-0"
            style={ringStyle}
            aria-label={t("result.scoreLabel")}
          >
            <div>
              <div className="leading-tight">
                <p className="text-ink text-center text-2xl font-extrabold tracking-tight tabular-nums">
                  {t("result.percentage", { percentage })}
                </p>
                <p className="text-ink-2 text-center text-xs font-bold tabular-nums">
                  {t("result.fraction", {
                    earned: score.pointsEarned,
                    possible: score.pointsPossible,
                  })}
                </p>
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1 basis-64">
            <h1 className="screen-title">{t("result.headline")}</h1>
            {score.isPersonalBest ? (
              <p className="screen-subtitle text-teal font-semibold">
                {t("result.personalBest")}
              </p>
            ) : null}
            <p className="text-ink-2 mt-2 text-sm">
              {t("result.summary", {
                answered: score.answered,
                correct: score.correct,
                incorrect: score.incorrect,
                unanswered: score.unanswered,
              })}
            </p>

            <div className="mt-4 space-y-3">
              {score.sections.map((section) => (
                <section
                  key={`${section.type}-${section.title}`}
                  data-section-type={section.type}
                >
                  <div className="text-ink mb-1 flex items-center justify-between gap-4 text-sm font-bold">
                    <span>{section.title}</span>
                    <span className="tabular-nums">
                      {t("result.fraction", {
                        earned: section.pointsEarned,
                        possible: section.pointsPossible,
                      })}
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={section.title}
                    aria-valuemin={0}
                    aria-valuenow={section.pointsEarned}
                    aria-valuemax={section.pointsPossible}
                    className="score-bar"
                  >
                    <div
                      className={sectionBarColour(section.type)}
                      style={{ width: `${scorePercentage(section)}%` }}
                    />
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>

        <p className="text-faint text-xs leading-relaxed">
          {t("result.practiceNotice", {
            title: result.test.title,
            version: result.test.version,
          })}
        </p>
      </main>

      <footer className="device-footer flex-wrap">
        <Link className="device-button" data-variant="ghost" to="/">
          {t("result.backToLibrary")}
        </Link>
        <span className="grow" />
        <a
          className="device-button"
          href={`/attempts/${result.attemptId}/review`}
        >
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
