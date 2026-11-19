import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
  listMathCandidates,
  listMathGenerationRequests,
  type MathCandidateSummary,
} from "../lib/math-candidates-api.js"

const optionalId = z.uuid().optional().catch(undefined)
const searchSchema = z.object({ requestId: optionalId, cursor: optionalId })
const linkClass =
  "text-teal inline-flex min-h-11 items-center font-semibold underline underline-offset-4"

async function loadQueue(
  { cursor, requestId }: z.output<typeof searchSchema>,
  signal: AbortSignal,
) {
  const requests = await listMathGenerationRequests(cursor, signal)
  const selectedRequestId = requestId ?? requests.items.at(0)?.id
  const candidates = selectedRequestId
    ? await listMathCandidates(selectedRequestId, signal).catch(() => null)
    : []

  return { requests, candidates, selectedRequestId }
}

function candidatePrompt(candidate: MathCandidateSummary): string | undefined {
  for (const block of candidate.promptBlocks ?? []) {
    if (block.kind === "text" && block.value.trim() !== "") {
      return block.value
    }
  }

  return undefined
}

function CandidateQueue() {
  const { i18n, t } = useTranslation("runner")
  const router = useRouter()
  const { cursor } = Route.useSearch()
  const { requests, candidates, selectedRequestId } = Route.useLoaderData()
  const date = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  })

  return (
    <section aria-labelledby="candidate-queue-title">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="candidate-queue-title" className="screen-title">
          {t("admin.candidates.queueTitle", {
            defaultValue: "Candidate review queue",
          })}
        </h2>
        <button
          type="button"
          className="device-button"
          data-variant="secondary"
          onClick={() => void router.invalidate()}
        >
          {t("admin.candidates.refresh", { defaultValue: "Refresh" })}
        </button>
      </header>

      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <section
          className="device-card min-w-0"
          aria-labelledby="candidate-requests-title"
        >
          <h3 id="candidate-requests-title" className="mb-3 font-bold">
            {t("admin.candidates.requestsTitle", {
              defaultValue: "Generation requests",
            })}
          </h3>
          {requests.items.length === 0 && (
            <p className="text-ink-2">
              {t("admin.candidates.noRequests", {
                defaultValue: "No generation requests found.",
              })}
            </p>
          )}
          <ul className="space-y-2">
            {requests.items.map((request) => (
              <li key={request.id}>
                <Link
                  to="/admin/candidates"
                  search={{ requestId: request.id, cursor }}
                  aria-current={
                    request.id === selectedRequestId ? "true" : undefined
                  }
                  className="hover:bg-teal-bg aria-[current=true]:bg-teal-bg border-line block min-h-11 rounded-md border p-3"
                >
                  <span className="block font-semibold wrap-anywhere">
                    {request.parameters.templateCode ?? request.id}
                  </span>
                  <span className="text-ink-2 mt-1 flex flex-wrap justify-between gap-x-2 text-sm">
                    <time dateTime={request.createdAt}>
                      {date.format(new Date(request.createdAt))}
                    </time>
                    {t(`admin.candidates.requestStatus.${request.status}`, {
                      defaultValue: request.status,
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-x-4">
            {cursor && (
              <Link to="/admin/candidates" search={{}} className={linkClass}>
                {t("admin.candidates.newestRequests", {
                  defaultValue: "Newest requests",
                })}
              </Link>
            )}
            {requests.nextCursor && (
              <Link
                to="/admin/candidates"
                search={{ cursor: requests.nextCursor }}
                className={linkClass}
              >
                {t("admin.candidates.olderRequests", {
                  defaultValue: "Older requests",
                })}
              </Link>
            )}
          </div>
        </section>

        <section
          className="device-card min-w-0"
          aria-labelledby="candidate-list-title"
        >
          <h3 id="candidate-list-title" className="mb-3 font-bold">
            {t("admin.candidates.candidateList", {
              defaultValue: "Candidates",
            })}
          </h3>
          {candidates === null && (
            <p role="alert" className="text-bad">
              {t("admin.candidates.candidatesError", {
                defaultValue: "Could not load candidates for this request.",
              })}
            </p>
          )}
          {candidates?.length === 0 && (
            <p className="text-ink-2">
              {t("admin.candidates.noCandidates", {
                defaultValue: "No candidates to review yet.",
              })}
            </p>
          )}
          <ul className="divide-line divide-y">
            {candidates?.map((candidate) => (
              <li
                key={candidate.id}
                className="flex flex-wrap items-center justify-between gap-x-4 py-2"
              >
                <Link
                  to="/admin/candidates/$candidateId"
                  params={{ candidateId: candidate.id }}
                  search={{ cursor }}
                  className={`${linkClass} min-w-0 wrap-anywhere`}
                >
                  {candidatePrompt(candidate) ??
                    t("admin.candidates.unnamed", {
                      defaultValue: "Candidate {{id}}",
                      id: candidate.id,
                    })}
                </Link>
                <span className="text-ink-2 text-sm capitalize">
                  {t(`admin.candidates.status.${candidate.status}`, {
                    defaultValue: candidate.status.replaceAll("_", " "),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  )
}

function QueuePending() {
  const { t } = useTranslation("runner")

  return (
    <p role="status" className="device-card text-ink-2">
      {t("admin.candidates.loadingQueue", {
        defaultValue: "Loading candidate queue…",
      })}
    </p>
  )
}

function QueueError() {
  const { t } = useTranslation("runner")

  return (
    <p role="alert" className="device-card text-bad">
      {t("admin.candidates.queueError", {
        defaultValue: "Could not load the candidate queue.",
      })}
    </p>
  )
}

export const Route = createFileRoute("/admin/candidates/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps, abortController }) =>
    loadQueue(deps, abortController.signal),
  pendingComponent: QueuePending,
  errorComponent: QueueError,
  component: CandidateQueue,
})
