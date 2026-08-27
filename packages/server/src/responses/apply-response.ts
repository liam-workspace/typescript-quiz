import type { PgQueryable } from "@liam-public/node-postgres"
import {
  loadQuestionSectionInfo,
  type AttemptRow,
  type ResponseWriteInput,
  type WriteOutcome,
} from "@pp/db"
import type { CapturedRequest } from "../http/raw-body-json.middleware.js"
import { CapturableBadRequestException } from "../validation/zod-body-validation.pipe.js"
import { captureItemRejection } from "./capture.js"
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

    const outcome = await input.write({
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
