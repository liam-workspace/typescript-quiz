import {
  Button,
  Card,
  CardContent,
  CardFooter,
} from "@liam-public/browser-react-ui"
import { Link, createFileRoute, redirect } from "@tanstack/react-router"
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
      return "bg-teal-700"

    case "reading":
      return "bg-orange-700"

    case "vocabulary":
      return "bg-indigo-700"

    case "grammar":
      return "bg-rose-700"
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

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl items-center px-4 py-8 sm:px-8">
      <Card className="w-full overflow-hidden border-stone-200 bg-stone-50 shadow-md">
        <CardContent className="grid gap-8 px-6 sm:px-10 lg:grid-cols-[9rem_1fr] lg:items-center">
          <div
            className="mx-auto grid size-32 place-items-center rounded-full sm:size-36"
            style={{
              background: `conic-gradient(#0f766e 0 ${ringPercentage}%, #e7e5e4 ${ringPercentage}% 100%)`,
            }}
            aria-label={t("result.scoreLabel")}
          >
            <div className="grid size-[6.5rem] place-items-center rounded-full bg-stone-50 text-center sm:size-[7.25rem]">
              <div className="leading-tight">
                <p className="text-3xl font-extrabold tracking-tight text-stone-900 tabular-nums">
                  {t("result.percentage", { percentage })}
                </p>
                <p className="text-sm font-bold text-stone-600 tabular-nums">
                  {t("result.fraction", {
                    earned: score.pointsEarned,
                    possible: score.pointsPossible,
                  })}
                </p>
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-stone-900">
              {t("result.headline")}
            </h1>
            {score.isPersonalBest ? (
              <p className="mt-1 font-semibold text-teal-800">
                {t("result.personalBest")}
              </p>
            ) : null}
            <p className="mt-3 text-sm text-stone-600">
              {t("result.summary", {
                answered: score.answered,
                correct: score.correct,
                incorrect: score.incorrect,
                unanswered: score.unanswered,
              })}
            </p>

            <div className="mt-6 space-y-4">
              {score.sections.map((section) => (
                <div key={`${section.type}-${section.title}`}>
                  <div className="mb-1.5 flex items-center justify-between gap-4 text-sm font-bold text-stone-800">
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
                    className="h-2 overflow-hidden rounded-full bg-stone-200"
                  >
                    <div
                      className={`h-full rounded-full ${sectionBarColour(section.type)}`}
                      style={{ width: `${scorePercentage(section)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs leading-relaxed text-stone-500 lg:col-span-2">
            {t("result.practiceNotice", {
              title: result.test.title,
              version: result.test.version,
            })}
          </p>
        </CardContent>

        <CardFooter className="flex flex-wrap justify-between gap-3 border-t border-stone-200 bg-white px-6 sm:px-10">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-11 min-w-11 touch-manipulation select-none"
          >
            <Link to="/">{t("result.backToLibrary")}</Link>
          </Button>
          <Button
            asChild
            size="sm"
            className="h-11 min-w-11 touch-manipulation select-none"
          >
            <a href={`/attempts/${result.attemptId}/review`}>
              {t("result.reviewAnswers")}
            </a>
          </Button>
        </CardFooter>
      </Card>
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
