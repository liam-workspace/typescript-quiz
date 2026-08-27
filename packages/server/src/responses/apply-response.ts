import type { PgQueryable } from "@liam-public/node-postgres"
import {
  loadQuestionSectionInfo,
  type AttemptRow,
  type ResponseWriteInput,
  type WriteOutcome,
} from "@pp/db"
import type { CapturedRequest } from "../http/raw-body-json.middleware.js"
import { CapturableBadRequestException } from "../validation/zod-body-validation.pipe.js"
import { captureItemRejection, captureUnexpectedWriteError } from "./capture.js"
import {
  ResponseSnapshotItemSchema,
  ResponseSnapshotQuestionIdentitySchema,
} from "./dto.js"
import {
  mapWriteConflict,
  resolveSectionRules,
  type SectionRules,
} from "./section-rules.js"

export interface ItemResult {
  questionId: string
  status: "applied" | "ignored_stale" | "rejected"
  reason?: string
  retryable?: false
  capturedAs?: string
}

interface ResponseItemLike {
  questionId: string
}

interface ApplyResponseItemsInput {
  attempt: AttemptRow
  clientInstanceId: string
  responses: ResponseItemLike[]
  now: Date
  req: CapturedRequest
  write: (input: ResponseWriteInput) => Promise<WriteOutcome>
  // A stable, non-transactional handle for `captureUnexpectedWriteError`
  // specifically -- deliberately NOT the same as this function's own `db`
  // parameter. For the snapshot-flush caller `db` already IS the request
  // pool, so the two coincide; for submit, `db` is the SHARED transaction
  // `submitAttemptRow` opened, which an unrecognised write error aborts
  // (this function throws, submit rolls the whole thing back) -- writing
  // the `failed_write` capture through THAT transaction would have it
  // erased by the very rollback it exists to survive. `capturePool` is
  // always the app's ordinary request pool, so the capture commits
  // independently of whatever the write transaction decides.
  capturePool: PgQueryable
}

export interface AppliedResponseItems {
  results: ItemResult[]
  sharedRules: SectionRules | undefined
}

function canonicalUuid(value: string): string {
  return value.toLowerCase()
}

/**
 * The one per-item response applier shared by snapshot flush and submit.
 * The caller chooses only the transaction boundary through `write`: snapshot
 * opens one transaction per item, while submit supplies its already-open
 * attempt transaction. Validation, section rules, reorder outcomes and
 * failed-write capture stay identical.
 */
export async function applyResponseItems(
  db: PgQueryable,
  input: ApplyResponseItemsInput,
): Promise<AppliedResponseItems> {
  const parsedItems = input.responses.map((item) => ({
    raw: item,
    parsed: ResponseSnapshotItemSchema.safeParse(item),
  }))
  const questionIdentities = input.responses.flatMap((item) => {
    const identity = ResponseSnapshotQuestionIdentitySchema.safeParse(item)

    return identity.success ? [identity.data] : []
  })
  const sectionInfo = await loadQuestionSectionInfo(db, {
    testVersionId: input.attempt.testVersionId,
    questionIds: questionIdentities.map((item) => item.questionId),
  })
  const sectionIds = new Set(
    [...sectionInfo.values()].map((info) => info.sectionId),
  )

  if (sectionIds.size > 1) {
    throw new CapturableBadRequestException(
      "mixed_sections",
      "Snapshot questions span more than one section",
    )
  }

  const firstResolvedItem = questionIdentities.find((item) =>
    sectionInfo.has(canonicalUuid(item.questionId)),
  )
  let sharedRules: SectionRules | undefined = undefined

  if (firstResolvedItem) {
    sharedRules = await resolveSectionRules(db, {
      attempt: input.attempt,
      questionId: firstResolvedItem.questionId,
    })
    mapWriteConflict(sharedRules, input.now)
  }

  const results: ItemResult[] = []

  // Sequential by contract: duplicate question IDs are legal, so their
  // arrival order must be deterministic within both snapshot and submit.
  /* eslint-disable no-await-in-loop */
  for (const { raw, parsed } of parsedItems) {
    if (!parsed.success) {
      results.push({
        questionId: raw.questionId,
        status: "rejected",
        reason: "invalid",
        retryable: false,
        capturedAs: await captureItemRejection(db, input.req, {
          attemptId: input.attempt.id,
          body: raw,
          now: input.now,
          reason: "invalid",
          clientInstanceId: input.clientInstanceId,
        }),
      })

      continue
    }

    const item = parsed.data
    const info = sectionInfo.get(canonicalUuid(item.questionId))
    const rules = info
      ? await resolveSectionRules(db, {
          attempt: input.attempt,
          questionId: item.questionId,
        })
      : undefined

    if (rules?.navigationLocked) {
      results.push({
        questionId: item.questionId,
        status: "rejected",
        reason: "navigation_locked",
        retryable: false,
        capturedAs: await captureItemRejection(db, input.req, {
          attemptId: input.attempt.id,
          body: item,
          now: input.now,
          reason: "navigation_locked",
          clientInstanceId: input.clientInstanceId,
        }),
      })

      continue
    }

    // `input.write` (`writeResponse` for a PATCH flush, or `applyResponse`
    // sharing submit's own transaction) rethrows a database error it does
    // not recognise as one of its own rejection reasons -- see
    // `captureUnexpectedWriteError`'s doc comment for why this catch has to
    // exist at all. Deliberately aborts the WHOLE request rather than
    // trying to keep processing the rest of `parsedItems`: every item
    // already applied in THIS loop committed in its own transaction (for
    // the PATCH path) or shares submit's still-open one, either way safely
    // -- but the client never sees `results` for anything from here on, so
    // per FlushController's own reconcile rule ("absent from results
    // entirely... stays queued and rides the next flush") nothing is lost,
    // only possibly redundantly resent, which the reorder guard makes a
    // no-op.
    const outcome: WriteOutcome = await (async () => {
      try {
        return await input.write({
          attemptId: input.attempt.id,
          questionId: item.questionId,
          testVersionId: input.attempt.testVersionId,
          clientInstanceId: input.clientInstanceId,
          seq: item.seq,
          selectedChoiceIds: item.selectedChoiceIds,
          answeredAt: item.answeredAt ? new Date(item.answeredAt) : null,
          timeSpentMs: item.timeSpentMs ?? null,
          allowAnswerChange: rules?.allowAnswerChange ?? true,
          now: input.now,
        })
      } catch (error) {
        // `input.capturePool`, NOT `db` -- see `ApplyResponseItemsInput`'s
        // doc comment on `capturePool` for why this specific call must not
        // use whatever transaction `db` might be.
        throw await captureUnexpectedWriteError(input.capturePool, input.req, {
          attemptId: input.attempt.id,
          body: item,
          now: input.now,
          clientInstanceId: input.clientInstanceId,
          error,
        })
      }
    })()

    if (outcome.kind === "rejected") {
      results.push({
        questionId: item.questionId,
        status: "rejected",
        reason: outcome.reason,
        retryable: false,
        capturedAs: await captureItemRejection(db, input.req, {
          attemptId: input.attempt.id,
          body: item,
          now: input.now,
          reason: outcome.reason,
          clientInstanceId: input.clientInstanceId,
        }),
      })
    } else {
      results.push({ questionId: item.questionId, status: outcome.kind })
    }
  }
  /* eslint-enable no-await-in-loop */

  return { results, sharedRules }
}
