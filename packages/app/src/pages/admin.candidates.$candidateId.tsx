import {
  renderCanonicalLatex,
  verifyMathProblem,
  type ContentBlock,
} from "@pp/common"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useState, type SubmitEvent } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { canRenderMathContent, MathContent } from "../components/MathContent.js"
import { ApiError } from "../lib/api-client.js"
import {
  getMathCandidate,
  getMathCandidateRawOutput,
  reviewMathCandidate,
  type MathCandidateDetail,
} from "../lib/math-candidates-api.js"

const searchSchema = z.object({ cursor: z.uuid().optional().catch(undefined) })
const statuses = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  regeneration_requested: "Regeneration requested",
}

function canonicalExpression(
  spec: MathCandidateDetail["canonicalSpec"],
): ContentBlock[] {
  if (!spec || !verifyMathProblem(spec).valid) {
    return []
  }

  return [
    { kind: "math", tex: renderCanonicalLatex(spec.expression), display: true },
  ]
}

function CandidatePreview({
  candidate,
}: {
  readonly candidate: MathCandidateDetail
}) {
  const { t } = useTranslation("runner")
  const correctChoice = candidate.choices?.find((choice) => choice.isCorrect)

  return (
    <div className="min-w-0 space-y-4">
      <section
        className="device-card min-w-0"
        aria-labelledby="candidate-preview-title"
      >
        <h3 id="candidate-preview-title" className="mb-3 font-bold">
          {t("admin.candidates.preview", { defaultValue: "Learner preview" })}
        </h3>
        {candidate.promptBlocks?.length ? (
          <div className="text-lg">
            <MathContent blocks={candidate.promptBlocks} />
          </div>
        ) : (
          <p className="text-ink-2">
            {t("admin.candidates.noPreview", {
              defaultValue: "No learner presentation is available.",
            })}
          </p>
        )}
        {candidate.choices && (
          <ol
            className="choice-stack mt-3"
            aria-label={t("admin.candidates.choices", {
              defaultValue: "Choices",
            })}
          >
            {candidate.choices.map((choice, index) => (
              <li
                key={index}
                className="choice hover:border-line min-w-0 cursor-default"
              >
                <MathContent
                  blocks={
                    choice.labelBlocks.length > 0
                      ? choice.labelBlocks
                      : [{ kind: "text", value: choice.label }]
                  }
                />
              </li>
            ))}
          </ol>
        )}
      </section>

      <section
        className="device-card min-w-0"
        aria-labelledby="candidate-solution-title"
      >
        <h3 id="candidate-solution-title" className="mb-3 font-bold">
          {t("admin.candidates.solution", { defaultValue: "Worked solution" })}
        </h3>
        {correctChoice && (
          <dl className="mb-3">
            <dt className="text-ink-2 text-sm font-semibold">
              {t("admin.candidates.correctAnswer", {
                defaultValue: "Correct answer",
              })}
            </dt>
            <dd>
              {correctChoice.labelBlocks.length > 0 ? (
                <MathContent blocks={correctChoice.labelBlocks} />
              ) : (
                correctChoice.label
              )}
            </dd>
          </dl>
        )}
        {candidate.solutionBlocks?.length ? (
          <MathContent blocks={candidate.solutionBlocks} />
        ) : (
          <p className="text-ink-2">
            {t("admin.candidates.noSolution", {
              defaultValue: "No worked solution is available.",
            })}
          </p>
        )}
      </section>
    </div>
  )
}

function CandidateEvidence({
  candidate,
  canonical,
}: {
  readonly candidate: MathCandidateDetail
  readonly canonical: ContentBlock[]
}) {
  const { t } = useTranslation("runner")
  const { validation, provenance } = candidate
  const fields = [
    [
      t("admin.candidates.requestId", { defaultValue: "Request ID" }),
      candidate.requestId,
    ],
    [
      t("admin.candidates.templateId", { defaultValue: "Template ID" }),
      provenance.templateId,
    ],
    [
      t("admin.candidates.provider", { defaultValue: "Provider" }),
      provenance.provider,
    ],
    [t("admin.candidates.model", { defaultValue: "Model" }), provenance.model],
    [
      t("admin.candidates.templateVersion", {
        defaultValue: "Prompt template version",
      }),
      provenance.promptTemplateVersion,
    ],
    [t("admin.candidates.seed", { defaultValue: "Seed" }), provenance.seed],
    [
      t("admin.candidates.hash", { defaultValue: "Content hash" }),
      candidate.contentHash,
    ],
    [
      t("admin.candidates.draftVersionId", {
        defaultValue: "Imported version ID",
      }),
      candidate.testVersionId,
    ],
  ]

  return (
    <div className="min-w-0 space-y-4">
      <section
        className="device-card"
        aria-labelledby="candidate-validation-title"
      >
        <h3 id="candidate-validation-title" className="mb-3 font-bold">
          {t("admin.candidates.validation", { defaultValue: "Validation" })}
        </h3>
        {validation ? (
          <>
            <p
              className={
                validation.valid
                  ? "text-teal font-semibold"
                  : "text-bad font-semibold"
              }
            >
              {validation.valid
                ? t("admin.candidates.validationPassed", {
                    defaultValue: "Passed",
                  })
                : t("admin.candidates.validationFailed", {
                    defaultValue: "Failed",
                  })}
            </p>
            <p className="text-ink-2 mt-1 text-sm">
              {t("admin.candidates.validator", {
                defaultValue: "Validator: {{source}}",
                source: validation.source,
              })}
            </p>
            {validation.errors.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {validation.errors.map((error, index) => (
                  <li key={index} className="wrap-anywhere">
                    {error}
                  </li>
                ))}
              </ul>
            )}
            {validation.duplicateContentHash && (
              <p className="mt-2 text-sm wrap-anywhere">
                {t("admin.candidates.duplicateHash", {
                  defaultValue: "Matching content hash:",
                })}{" "}
                <code>{validation.duplicateContentHash}</code>
              </p>
            )}
          </>
        ) : (
          <p className="text-ink-2">
            {t("admin.candidates.noValidation", {
              defaultValue: "No validation report is available.",
            })}
          </p>
        )}
      </section>

      <section
        className="device-card min-w-0"
        aria-labelledby="candidate-canonical-title"
      >
        <h3 id="candidate-canonical-title" className="mb-3 font-bold">
          {t("admin.candidates.canonical", { defaultValue: "Canonical math" })}
        </h3>
        {canonical.length > 0 ? (
          <MathContent blocks={canonical} />
        ) : (
          <p className="text-ink-2">
            {t("admin.candidates.noCanonical", {
              defaultValue: "No verified canonical expression is available.",
            })}
          </p>
        )}
      </section>

      <section
        className="device-card min-w-0"
        aria-labelledby="candidate-provenance-title"
      >
        <h3 id="candidate-provenance-title" className="mb-3 font-bold">
          {t("admin.candidates.provenance", { defaultValue: "Provenance" })}
        </h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {fields.map(
            ([label, value]) =>
              value && (
                <div key={label} className="min-w-0">
                  <dt className="text-ink-2 font-semibold">{label}</dt>
                  <dd className="wrap-anywhere">{value}</dd>
                </div>
              ),
          )}
        </dl>
      </section>
    </div>
  )
}

type AuditView =
  | { state: "closed" | "loading" | "error" }
  | { state: "open"; rawResponse: unknown }

function CandidateAudit({ candidateId }: { readonly candidateId: string }) {
  const { t } = useTranslation("runner")
  const [audit, setAudit] = useState<AuditView>({ state: "closed" })

  async function toggleAudit() {
    if (audit.state !== "closed") {
      setAudit({ state: "closed" })

      return
    }

    setAudit({ state: "loading" })

    try {
      setAudit({
        state: "open",
        rawResponse: await getMathCandidateRawOutput(candidateId),
      })
    } catch {
      setAudit({ state: "error" })
    }
  }

  return (
    <section
      className="device-card min-w-0"
      aria-labelledby="candidate-audit-title"
    >
      <h3 id="candidate-audit-title" className="mb-3 font-bold">
        {t("admin.candidates.audit", { defaultValue: "Audit" })}
      </h3>
      <button
        type="button"
        className="device-button"
        data-variant="secondary"
        aria-expanded={audit.state !== "closed"}
        aria-controls="candidate-raw-output"
        disabled={audit.state === "loading"}
        onClick={() => void toggleAudit()}
      >
        {audit.state === "closed"
          ? t("admin.candidates.showRaw", {
              defaultValue: "Show raw provider output",
            })
          : t("admin.candidates.hideRaw", {
              defaultValue: "Hide raw provider output",
            })}
      </button>
      <div id="candidate-raw-output">
        {audit.state === "loading" && (
          <p role="status" className="text-ink-2 mt-3">
            {t("admin.candidates.loadingRaw", {
              defaultValue: "Loading audit data…",
            })}
          </p>
        )}
        {audit.state === "error" && (
          <p role="alert" className="text-bad mt-3">
            {t("admin.candidates.rawError", {
              defaultValue: "Could not load the raw provider output.",
            })}
          </p>
        )}
        {audit.state === "open" && (
          <pre className="border-line bg-paper mt-3 max-h-80 overflow-auto rounded-md border p-3 text-sm wrap-anywhere whitespace-pre-wrap">
            {JSON.stringify(audit.rawResponse, null, 2)}
          </pre>
        )}
      </div>
    </section>
  )
}

function CandidateDetail({
  initial,
}: {
  readonly initial: MathCandidateDetail
}) {
  const { i18n, t } = useTranslation("runner")
  const { cursor } = Route.useSearch()
  const [updated, setUpdated] = useState<MathCandidateDetail>()
  const [saving, setSaving] = useState(false)
  const [reviewError, setReviewError] = useState<"failed" | "conflict">()
  const candidate = updated ?? initial
  const canonical = canonicalExpression(candidate.canonicalSpec)
  const canReject =
    candidate.status === "in_review" || candidate.status === "draft"
  const canApprove =
    candidate.status === "in_review" &&
    candidate.validation?.valid === true &&
    canonical.length > 0 &&
    Boolean(candidate.promptBlocks?.length) &&
    Boolean(candidate.choices?.length) &&
    canRenderMathContent([
      ...canonical,
      ...(candidate.promptBlocks ?? []),
      ...(candidate.solutionBlocks ?? []),
      ...(candidate.choices ?? []).flatMap((choice) => choice.labelBlocks),
    ])
  const date = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  })

  async function saveReview(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget, event.nativeEvent.submitter)
    const decision = data.get("decision")

    if (
      saving ||
      !(
        (decision === "approved" && canApprove) ||
        (decision === "rejected" && canReject)
      )
    ) {
      return
    }

    const reasonField = data.get("reason")
    const reason = typeof reasonField === "string" ? reasonField.trim() : ""
    setSaving(true)
    setReviewError(undefined)

    try {
      setUpdated(
        await reviewMathCandidate(
          candidate.id,
          decision,
          reason === "" ? undefined : reason,
        ),
      )
    } catch (error) {
      if (error instanceof ApiError && error.problem.status === 409) {
        setReviewError("conflict")
        const latest = await getMathCandidate(candidate.id).catch(
          () => undefined,
        )

        if (latest) {
          setUpdated(latest)
        }
      } else {
        setReviewError("failed")
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="candidate-review-title">
      <header>
        <Link
          to="/admin/candidates"
          search={{ requestId: candidate.requestId, cursor }}
          className="text-teal inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
        >
          {t("admin.candidates.backToQueue", {
            defaultValue: "Back to candidate queue",
          })}
        </Link>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="candidate-review-title" className="screen-title">
            {t("admin.candidates.reviewTitle", {
              defaultValue: "Review candidate",
            })}
          </h2>
          <span
            role="status"
            className="bg-teal-bg text-teal rounded-full px-3 py-1 text-sm font-semibold"
          >
            {t(`admin.candidates.status.${candidate.status}`, {
              defaultValue: statuses[candidate.status],
            })}
          </span>
        </div>
        <time dateTime={candidate.createdAt} className="text-ink-2 text-sm">
          {date.format(new Date(candidate.createdAt))}
        </time>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <CandidatePreview candidate={candidate} />
        <CandidateEvidence candidate={candidate} canonical={canonical} />
      </div>

      <section
        className="device-card"
        aria-labelledby="candidate-decision-title"
      >
        <h3 id="candidate-decision-title" className="mb-3 font-bold">
          {t("admin.candidates.decision", { defaultValue: "Review decision" })}
        </h3>
        {candidate.reviewReason && (
          <p className="wrap-anywhere whitespace-pre-wrap">
            {candidate.reviewReason}
          </p>
        )}
        {candidate.reviewerSubject && (
          <p className="text-ink-2 text-sm wrap-anywhere">
            {t("admin.candidates.reviewedBy", {
              defaultValue: "Reviewed by {{reviewer}}",
              reviewer: candidate.reviewerSubject,
            })}
            {candidate.reviewedAt && (
              <>
                {" · "}
                <time dateTime={candidate.reviewedAt}>
                  {date.format(new Date(candidate.reviewedAt))}
                </time>
              </>
            )}
          </p>
        )}
        {reviewError && (
          <p role="alert" className="text-bad mb-3">
            {reviewError === "conflict"
              ? t("admin.candidates.reviewConflict", {
                  defaultValue:
                    "The candidate changed while you were reviewing it.",
                })
              : t("admin.candidates.reviewError", {
                  defaultValue:
                    "Could not save the review decision. Try again.",
                })}
          </p>
        )}
        {canReject && (
          <form
            onSubmit={(event) => void saveReview(event)}
            className="space-y-3"
          >
            <label className="grid gap-1 text-sm font-semibold">
              {t("admin.candidates.reason", {
                defaultValue: "Review reason (optional)",
              })}
              <textarea
                name="reason"
                rows={2}
                maxLength={2000}
                disabled={saving}
                className="border-line bg-paper rounded-md border px-3 py-2 font-normal"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {canApprove && (
                <button
                  type="submit"
                  name="decision"
                  value="approved"
                  disabled={saving}
                  className="device-button"
                  data-variant="primary"
                >
                  {t("admin.candidates.approve", { defaultValue: "Approve" })}
                </button>
              )}
              <button
                type="submit"
                name="decision"
                value="rejected"
                disabled={saving}
                className="device-button"
                data-variant="secondary"
              >
                {t("admin.candidates.reject", { defaultValue: "Reject" })}
              </button>
            </div>
          </form>
        )}
      </section>
      <CandidateAudit candidateId={candidate.id} />
    </section>
  )
}

function CandidateDetailRoute() {
  const candidate = Route.useLoaderData()

  return <CandidateDetail key={candidate.id} initial={candidate} />
}

function DetailPending() {
  const { t } = useTranslation("runner")

  return (
    <p role="status" className="device-card text-ink-2">
      {t("admin.candidates.loadingDetail", {
        defaultValue: "Loading candidate…",
      })}
    </p>
  )
}

function DetailError() {
  const { t } = useTranslation("runner")
  const { cursor } = Route.useSearch()

  return (
    <div className="device-card">
      <p role="alert" className="text-bad">
        {t("admin.candidates.detailError", {
          defaultValue: "Could not load this candidate.",
        })}
      </p>
      <Link
        to="/admin/candidates"
        search={{ cursor }}
        className="text-teal inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
      >
        {t("admin.candidates.backToQueue", {
          defaultValue: "Back to candidate queue",
        })}
      </Link>
    </div>
  )
}

export const Route = createFileRoute("/admin/candidates/$candidateId")({
  validateSearch: searchSchema,
  loader: ({ params, abortController }) =>
    getMathCandidate(params.candidateId, abortController.signal),
  pendingComponent: DetailPending,
  errorComponent: DetailError,
  component: CandidateDetailRoute,
})
