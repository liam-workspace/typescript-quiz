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
    <div className="device-page">
      <header className="app-bar">
        <span className="app-brand truncate">{data.testTitle}</span>
        <span className="grow" />
        <span
          aria-label={t("timeUp.clockLabel")}
          className="timer timer-low text-clay text-sm font-bold"
        >
          00:00
        </span>
      </header>

      <main className="center-main">
        <h1 className="screen-title">{t("timeUp.title")}</h1>
        <p className="screen-subtitle max-w-[40ch]">
          {t("timeUp.message")}
        </p>

        <section className="device-card mt-[15px] w-full max-w-[340px] text-left">
          <div className="summary-row flex items-center justify-between gap-4 py-1 text-sm">
            <span>{t("timeUp.answered")}</span>
            <strong className="tabular-nums">{data.answeredCount}</strong>
          </div>
          <div className="summary-row text-ink-2 flex items-center justify-between gap-4 py-1 text-sm">
            <span>{t("timeUp.leftBlank")}</span>
            <strong className="tabular-nums">{data.unansweredCount}</strong>
          </div>
        </section>

        {parsedResultUrl.success ? (
          <a href={parsedResultUrl.data} className="device-button mt-[18px]">
            {t("timeUp.seeResult")}
          </a>
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
