import { Button } from "@liam-public/browser-react-ui"
import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import type { FinalizedAttempt } from "../lib/api-types.js"
import { getAttemptResult } from "../lib/attempts-api.js"
import { sameOriginPath } from "../lib/same-origin-path.js"
import { takeTimeUpAttempt } from "../lib/time-up-navigation.js"

export interface TimeUpData {
  readonly testTitle: string
  readonly answeredCount: number
  readonly unansweredCount: number
  readonly resultUrl: string
}

export async function loadTimeUp(
  attemptId: string,
  attempt?: FinalizedAttempt,
): Promise<TimeUpData> {
  const result = await getAttemptResult(attemptId)

  return {
    testTitle: result.test.title,
    answeredCount: result.score.answered,
    unansweredCount: result.score.unanswered,
    resultUrl:
      attempt?.id === result.attemptId
        ? attempt.resultUrl
        : `/attempts/${result.attemptId}/result`,
  }
}

export interface TimeUpScreenProps {
  readonly data: TimeUpData
}

export function TimeUpScreen({ data }: TimeUpScreenProps) {
  const { t } = useTranslation("runner")
  const parsedResultUrl = sameOriginPath.safeParse(data.resultUrl)

  return (
    <div className="bg-surface text-ink min-h-screen">
      <header className="border-line bg-paper flex items-center justify-between gap-4 border-b px-4 py-3">
        <span className="truncate text-sm font-bold">{data.testTitle}</span>
        <span
          aria-label={t("timeUp.clockLabel")}
          className="rounded-device border-line bg-surface text-clay border px-3 py-1 text-sm font-bold tabular-nums"
        >
          00:00
        </span>
      </header>

      <main className="mx-auto flex max-w-xl flex-col items-center px-5 py-14 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">
          {t("timeUp.title")}
        </h1>
        <p className="text-ink-2 mt-3 max-w-[40ch] leading-relaxed">
          {t("timeUp.message")}
        </p>

        <div className="border-line bg-paper rounded-device mt-6 w-full max-w-sm border p-4 text-left">
          <div className="flex items-center justify-between gap-4 py-1 text-sm">
            <span>{t("timeUp.answered")}</span>
            <strong className="tabular-nums">{data.answeredCount}</strong>
          </div>
          <div className="text-ink-2 flex items-center justify-between gap-4 py-1 text-sm">
            <span>{t("timeUp.leftBlank")}</span>
            <strong className="tabular-nums">{data.unansweredCount}</strong>
          </div>
        </div>

        {parsedResultUrl.success ? (
          <Button
            asChild
            className="bg-teal text-paper mt-6 h-11 min-w-11 touch-manipulation px-5 select-none"
          >
            <a href={parsedResultUrl.data}>{t("timeUp.seeResult")}</a>
          </Button>
        ) : null}
      </main>
    </div>
  )
}

export const Route = createFileRoute("/attempts/$attemptId/time-up")({
  loader: ({ params }) =>
    loadTimeUp(
      params.attemptId,
      takeTimeUpAttempt(window.sessionStorage, params.attemptId),
    ),
  component: RouteComponent,
})

function RouteComponent() {
  const data = Route.useLoaderData()

  return <TimeUpScreen data={data} />
}
