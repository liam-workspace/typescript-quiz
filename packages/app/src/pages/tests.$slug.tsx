import { Card, CardContent } from "@liam-public/browser-react-ui"
import { createFileRoute, defaultStringifySearch } from "@tanstack/react-router"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ApiError } from "../lib/api-client.js"
import { startAttempt } from "../lib/attempts-api.js"
import type { AttemptStart, TestBrief } from "../lib/api-types.js"
import { getTest } from "../lib/catalog-api.js"

export interface TestBriefScreenProps {
  readonly brief: TestBrief
  readonly navigate: (path: string) => void
}

function sectionRulesPath(attempt: AttemptStart, sectionId: string): string {
  const search = attempt.finalizedPriorAttempt
    ? defaultStringifySearch({
        finalizedPriorAttempt: attempt.finalizedPriorAttempt,
      })
    : ""

  return `/attempts/${attempt.id}/sections/${sectionId}/rules${search}`
}

export function TestBriefScreen({ brief, navigate }: TestBriefScreenProps) {
  const { t } = useTranslation("runner")
  const startingRef = useRef(false)
  const [starting, setStarting] = useState(false)
  const [startFailed, setStartFailed] = useState(false)
  const durationMinutes = Math.round(brief.durationSeconds / 60)
  const attemptNumber = brief.attemptCount + 1
  const firstSection = brief.sections.reduce<
    TestBrief["sections"][number] | undefined
  >(
    (first, section) =>
      !first || section.ordinal < first.ordinal ? section : first,
    undefined,
  )
  const step = t(
    brief.level === "primary-step-1" ? "library.step.1" : "library.step.2",
  )

  async function handleStart(): Promise<void> {
    if (startingRef.current || !firstSection) {
      return
    }

    startingRef.current = true
    setStarting(true)
    setStartFailed(false)

    try {
      const attempt = await startAttempt(brief.slug)
      navigate(sectionRulesPath(attempt, firstSection.id))
    } catch {
      startingRef.current = false
      setStarting(false)
      setStartFailed(true)
    }
  }

  return (
    <div className="bg-surface text-ink flex min-h-screen flex-col">
      <header className="border-line bg-paper border-b">
        <div className="mx-auto flex min-h-14 max-w-4xl items-center px-4 sm:px-6">
          <span className="text-ink font-extrabold tracking-tight">
            {t("library.brand")}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-7 sm:px-6 sm:py-9">
        <h1 className="text-ink text-[21px] font-extrabold tracking-[-0.015em]">
          {brief.title}
        </h1>
        <p className="text-ink-2 mt-1 text-sm">
          {t("brief.summary", {
            step,
            sectionCount:
              brief.sections.length === 2
                ? t("brief.sectionCount.two")
                : t("brief.sectionCount", { count: brief.sections.length }),
            duration: t("brief.durationMinutes", {
              count: durationMinutes,
            }),
            attempt: t("brief.attempt", { number: attemptNumber }),
          })}
        </p>

        <div className="mt-4 space-y-[11px]">
          {brief.sections.map((section) => {
            const titleId = `brief-section-${section.id}`
            const sectionMinutes = Math.round(section.durationSeconds / 60)

            return (
              <article
                key={section.id}
                aria-labelledby={titleId}
                className="border-line bg-paper rounded-[11px] border px-[19px] py-[17px]"
              >
                <div className="flex flex-wrap items-center gap-x-[11px] gap-y-2">
                  <span className="bg-teal-bg text-teal rounded-full px-3 py-1 text-xs font-bold">
                    {t(`library.section.${section.type}`)}
                  </span>
                  <h2 id={titleId} className="text-sm font-bold">
                    {section.title}
                  </h2>
                  <span className="text-ink text-sm font-bold">
                    {t("brief.questionCount", {
                      count: section.questionCount,
                    })}
                  </span>
                  <span className="grow" />
                  <span className="text-ink-2 text-[13.5px]">
                    {t("brief.durationMinutesShort", {
                      count: sectionMinutes,
                    })}
                  </span>
                </div>
                <ul className="text-ink-2 mt-2 space-y-1 text-[13px] leading-relaxed">
                  {section.instructions.map((instruction) => (
                    <li key={instruction}>{instruction}</li>
                  ))}
                </ul>
              </article>
            )
          })}
        </div>

        <p className="border-line bg-teal-bg text-ink-2 mt-[15px] rounded-[9px] border px-4 py-3 text-sm leading-relaxed">
          {t("brief.saveNotice")}
        </p>
        {startFailed ? (
          <p role="alert" className="text-bad mt-3 text-sm font-semibold">
            {t("brief.startError")}
          </p>
        ) : null}
      </main>

      <footer className="border-line bg-paper sticky bottom-0 border-t">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <a
            href="/"
            className="border-line bg-paper text-ink hover:bg-surface focus-visible:outline-teal inline-flex size-11 w-auto touch-manipulation items-center justify-center rounded-[9px] border px-4 text-sm font-bold select-none focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t("brief.back")}
          </a>
          <button
            type="button"
            className="border-teal bg-teal text-paper focus-visible:outline-teal inline-flex size-11 w-auto touch-manipulation items-center justify-center rounded-[9px] border px-5 text-sm font-bold select-none hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-70"
            disabled={starting || !firstSection}
            aria-busy={starting}
            onClick={() => void handleStart()}
          >
            {t(starting ? "brief.starting" : "brief.start")}
          </button>
        </div>
      </footer>
    </div>
  )
}

export function loadTestBrief(slug: string): Promise<TestBrief> {
  return getTest(slug)
}

export interface TestBriefRouteErrorProps {
  readonly error: unknown
}

export function TestBriefRouteError({ error }: TestBriefRouteErrorProps) {
  const { t } = useTranslation("runner")
  const notFound = error instanceof ApiError && error.problem.status === 404

  return (
    <div className="bg-surface min-h-screen px-4 py-12">
      <Card className="border-line bg-paper mx-auto max-w-xl">
        <CardContent className="space-y-4">
          <p role="alert">
            {t(notFound ? "brief.unavailable" : "brief.error")}
          </p>
          <a
            href="/"
            className="text-teal focus-visible:outline-teal inline-flex size-11 w-auto touch-manipulation items-center justify-center px-4 font-bold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t("brief.backToLibrary")}
          </a>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute("/tests/$slug")({
  loader: ({ params }) => loadTestBrief(params.slug),
  errorComponent: TestBriefRouteError,
  component: RouteComponent,
})

function RouteComponent() {
  const brief = Route.useLoaderData()

  const navigate = (path: string): void => {
    window.location.assign(path)
  }

  return <TestBriefScreen brief={brief} navigate={navigate} />
}
