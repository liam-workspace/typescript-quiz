import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { TimeUpView } from "../components/TimeUpView.js"
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
    <TimeUpView
      title={data.testTitle}
      heading={t("timeUp.title")}
      message={t("timeUp.message")}
      summary={{ answered: data.answeredCount, blank: data.unansweredCount }}
      action={
        parsedResultUrl.success
          ? {
              kind: "link",
              href: parsedResultUrl.data,
              label: t("timeUp.seeResult"),
            }
          : null
      }
    />
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
