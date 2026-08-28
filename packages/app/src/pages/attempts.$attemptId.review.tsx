import {
  Button,
  Card,
  CardContent,
  CardFooter,
} from "@liam-public/browser-react-ui"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ApiError } from "../lib/api-client.js"
import type {
  ReviewChoice,
  ReviewItem,
  ReviewPayload,
  ReviewStimulus,
} from "../lib/api-types.js"
import { getAttemptReview } from "../lib/attempts-api.js"

export async function loadReview(attemptId: string): Promise<ReviewPayload> {
  try {
    return await getAttemptReview(attemptId)
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

function outcomeClasses(outcome: ReviewItem["outcome"]): string {
  switch (outcome) {
    case "correct":
      return "border-emerald-200 bg-emerald-50 text-emerald-800"

    case "incorrect":
      return "border-rose-200 bg-rose-50 text-rose-800"

    case "unanswered":
      return "border-stone-200 bg-stone-100 text-stone-700"
  }
}

function choiceClasses(choice: ReviewChoice): string {
  if (choice.selected && choice.isCorrect) {
    return "border-emerald-300 bg-emerald-50"
  }

  if (choice.selected) {
    return "border-rose-300 bg-rose-50"
  }

  if (choice.isCorrect) {
    return "border-emerald-200 bg-white"
  }

  return "border-stone-200 bg-white"
}

function choiceDotClasses(choice: ReviewChoice): string {
  if (!choice.selected) {
    return "border-stone-400"
  }

  return choice.isCorrect
    ? "border-emerald-700 bg-emerald-700"
    : "border-rose-700 bg-rose-700"
}

/**
 * A `mixed` stimulus is text PLUS media, and its own `type` never says which
 * media -- only `mediaKind` does. Branching on `type` alone rendered every
 * mixed stimulus as an audio player, so a mixed passage-and-picture question
 * showed a child a dead audio control and no image.
 *
 * An `image` stimulus itself now has two shapes (a signed mediaUrl, or
 * inline imageSvg -- see Choice.imageSvg for why), so this returns the
 * relevant one rather than narrowing to a single `mediaUrl: string` member
 * the way it used to: `Extract<ReviewStimulus, { mediaUrl: string }>` would
 * silently drop the image variant now that ITS mediaUrl is optional.
 */
function imageSvgOf(stimulus: ReviewStimulus): string | undefined {
  return stimulus.type === "image" ? stimulus.imageSvg : undefined
}

function imageUrlOf(stimulus: ReviewStimulus): string | undefined {
  if (stimulus.type === "image") {
    return stimulus.mediaUrl
  }

  return stimulus.type === "mixed" && stimulus.mediaKind === "image"
    ? stimulus.mediaUrl
    : undefined
}

function audioUrlOf(stimulus: ReviewStimulus): string | undefined {
  if (stimulus.type === "audio") {
    return stimulus.mediaUrl
  }

  return stimulus.type === "mixed" && stimulus.mediaKind === "audio"
    ? stimulus.mediaUrl
    : undefined
}

interface ReviewStimulusViewProps {
  readonly stimulus: ReviewStimulus
}

function ReviewStimulusView({ stimulus }: ReviewStimulusViewProps) {
  const { t } = useTranslation("runner")

  return (
    <div className="mb-6 rounded-xl border border-stone-200 bg-stone-50 p-4">
      {stimulus.title ? (
        <h2 className="font-bold text-stone-900">{stimulus.title}</h2>
      ) : null}
      {"bodyText" in stimulus ? (
        <p className="mt-2 text-sm leading-6 whitespace-pre-line text-stone-700">
          {stimulus.bodyText}
        </p>
      ) : null}
      {imageSvgOf(stimulus) ? (
        <span
          aria-hidden="true"
          className="stimulus-image mt-3"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: imageSvgOf(stimulus) ?? "" }}
        />
      ) : null}
      {!imageSvgOf(stimulus) && imageUrlOf(stimulus) ? (
        <img
          className="mt-3 max-h-80 rounded-lg object-contain"
          src={imageUrlOf(stimulus)}
          alt={stimulus.title ?? t("review.imageAlt")}
        />
      ) : null}
      {audioUrlOf(stimulus) ? (
        <audio
          className="mt-3 w-full"
          src={audioUrlOf(stimulus)}
          controls
          aria-label={t("review.replayAudio")}
        />
      ) : null}
    </div>
  )
}

interface ReviewChoiceListProps {
  readonly choices: readonly ReviewChoice[]
}

function ReviewChoiceMarker({ choice }: { readonly choice: ReviewChoice }) {
  const { t } = useTranslation("runner")

  if (choice.selected) {
    const markerKey = choice.isCorrect
      ? "review.yourAnswerCorrect"
      : "review.yourAnswerIncorrect"

    return (
      <span
        className={`text-xs font-bold ${
          choice.isCorrect ? "text-emerald-800" : "text-rose-800"
        }`}
      >
        {t(markerKey)}
      </span>
    )
  }

  if (choice.isCorrect) {
    return (
      <span className="text-xs font-bold text-emerald-800">
        {t("review.correctAnswer")}
      </span>
    )
  }

  return null
}

// Mirrors ChoiceList.tsx's ChoiceImage: inline markup, not a URL, so the
// pictogram's `stroke="currentColor"` still picks up this row's colour
// (including the correct/incorrect `.choice` verdict tint here in review).
function ReviewChoiceImage({ svg }: { readonly svg: string }) {
  return (
    <span
      aria-hidden="true"
      className="choice-image"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

function ReviewChoiceList({ choices }: ReviewChoiceListProps) {
  const { t } = useTranslation("runner")

  return (
    <ul aria-label={t("review.answerChoices")} className="space-y-3">
      {choices.map((choice) => (
        <li
          key={choice.id}
          className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 py-3 text-stone-900 ${choiceClasses(choice)}`}
        >
          <span
            aria-hidden="true"
            className={`size-3 shrink-0 rounded-full border-2 ${choiceDotClasses(choice)}`}
          />
          {choice.imageSvg ? <ReviewChoiceImage svg={choice.imageSvg} /> : null}
          <span className="min-w-0 flex-1">{choice.label}</span>
          <ReviewChoiceMarker choice={choice} />
        </li>
      ))}
    </ul>
  )
}

export interface ReviewScreenProps {
  readonly review: ReviewPayload
}

export function ReviewScreen({ review }: ReviewScreenProps) {
  const { t } = useTranslation("runner")
  const [currentIndex, setCurrentIndex] = useState(0)

  if (review.items.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <Card>
          <CardContent>
            <p role="status">{t("review.empty")}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const current = review.items[currentIndex]

  // The server says which kind of section this is. It used to be guessed
  // from the section's POSITION in the item list -- right only for a
  // two-section test in the expected order, and the enum has four values.
  const sectionKey = current.sectionType
  const outcome = t(`review.outcome.${current.outcome}`)
  const atFirst = currentIndex === 0
  const atLast = currentIndex === review.items.length - 1

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6 sm:px-8 sm:py-8">
      <Card className="flex min-h-[calc(100vh-4rem)] flex-1 flex-col overflow-hidden border-stone-200 bg-stone-50 shadow-md">
        <header className="flex flex-wrap items-center gap-3 border-b border-stone-200 bg-white px-5 py-4 sm:px-8">
          <h1 className="text-lg font-extrabold tracking-tight text-stone-900">
            {t("review.title")}
          </h1>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              sectionKey === "listening"
                ? "bg-teal-100 text-teal-900"
                : "bg-orange-100 text-orange-900"
            }`}
          >
            {t(`runner.sectionChip.${sectionKey}`)}
          </span>
          <span className="ml-auto text-sm font-bold text-stone-600 tabular-nums">
            {t("review.position", {
              current: currentIndex + 1,
              total: review.items.length,
            })}
          </span>
        </header>

        <CardContent className="flex-1 px-5 py-7 sm:px-8">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-sm font-extrabold text-stone-600">
              {t("review.questionLabel", { ordinal: current.ordinal })}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-extrabold ${outcomeClasses(current.outcome)}`}
            >
              {outcome}
            </span>
          </div>

          {current.stimulus ? (
            <ReviewStimulusView stimulus={current.stimulus} />
          ) : null}

          <p className="mb-5 text-xl leading-snug font-bold text-stone-950 sm:text-2xl">
            {current.prompt}
          </p>
          <ReviewChoiceList choices={current.choices} />

          {current.outcome === "unanswered" ? (
            <p className="mt-4 text-sm font-semibold text-stone-600">
              {t("review.leftBlankNotice", { ordinal: current.ordinal })}
            </p>
          ) : null}

          <nav
            className="mt-8 border-t border-stone-200 pt-5"
            aria-label={t("review.jumpToQuestion")}
          >
            <p className="mb-3 text-xs font-extrabold tracking-wide text-stone-500 uppercase">
              {t("review.jumpToQuestion")}
            </p>
            <div className="flex flex-wrap gap-2">
              {review.items.map((item, index) => {
                const itemOutcome = t(`review.outcome.${item.outcome}`)

                return (
                  <button
                    key={item.questionId}
                    type="button"
                    onClick={() => setCurrentIndex(index)}
                    aria-current={index === currentIndex ? "step" : undefined}
                    aria-label={t("review.jumpLabel", {
                      ordinal: item.ordinal,
                      outcome: itemOutcome,
                    })}
                    className={`grid size-11 touch-manipulation place-items-center rounded-lg border text-sm font-extrabold tabular-nums transition select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 ${
                      index === currentIndex
                        ? "border-stone-900 bg-stone-900 text-white"
                        : outcomeClasses(item.outcome)
                    }`}
                  >
                    {item.ordinal}
                  </button>
                )
              })}
            </div>
          </nav>
        </CardContent>

        <CardFooter className="flex flex-wrap items-center gap-3 border-t border-stone-200 bg-white px-5 sm:px-8">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-11 min-w-11 touch-manipulation select-none"
          >
            <a href={`/attempts/${review.attemptId}/result`}>
              {t("review.backToResult")}
            </a>
          </Button>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-11 min-w-11 touch-manipulation select-none"
              disabled={atFirst}
              onClick={() => setCurrentIndex((index) => index - 1)}
            >
              {t("runner.previous")}
            </Button>
            <Button
              size="sm"
              className="h-11 min-w-11 touch-manipulation select-none"
              disabled={atLast}
              onClick={() => setCurrentIndex((index) => index + 1)}
            >
              {t("runner.next")}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}

export interface ReviewRouteErrorProps {
  readonly error: unknown
}

export function ReviewRouteError({ error }: ReviewRouteErrorProps) {
  const { t } = useTranslation("runner")
  const forbidden = error instanceof ApiError && error.problem.status === 403

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <Card>
        <CardContent>
          <p role="alert">
            {t(forbidden ? "review.forbidden" : "review.error")}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute("/attempts/$attemptId/review")({
  loader: ({ params }) => loadReview(params.attemptId),
  errorComponent: ReviewRouteError,
  component: RouteComponent,
})

function RouteComponent() {
  const review = Route.useLoaderData()

  return <ReviewScreen review={review} />
}
