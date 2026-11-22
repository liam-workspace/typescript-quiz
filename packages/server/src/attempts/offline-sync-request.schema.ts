import { z } from "zod"

const Uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "invalid_uuid",
  )

const base = {
  eventSeq: z.number().int().positive(),
  clientAt: z.iso.datetime(),
}

/**
 * One entry of a device's append-only attempt journal (spec D6, §13.1).
 * Answers are events too, so replay can interleave them with `position`
 * moves in the order they happened.
 */
export const OfflineJournalEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...base,
    type: z.literal("start"),
    payload: z.strictObject({ slug: z.string().min(1), testVersionId: Uuid }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("enter_section"),
    payload: z.strictObject({ sectionId: Uuid }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("play"),
    payload: z.strictObject({ stimulusId: Uuid }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("position"),
    payload: z.strictObject({ sectionId: Uuid, questionId: Uuid }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("answer"),
    payload: z.strictObject({
      sectionId: Uuid,
      questionId: Uuid,
      clientInstanceId: z.string().min(1),
      seq: z.number().int().nonnegative(),
      selectedChoiceIds: z
        .array(Uuid)
        .refine(
          (ids) =>
            new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
          "duplicate_choice",
        ),
      timeSpentMs: z.number().int().nonnegative().max(2_147_483_647).optional(),
    }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("finish_section"),
    payload: z.strictObject({ sectionId: Uuid }),
  }),
])

export type OfflineJournalEvent = z.infer<typeof OfflineJournalEventSchema>

export const OfflineSyncRequestSchema = z.strictObject({
  /** The client-minted uuid; becomes `attempt.id` when the server adopts the attempt. */
  attemptId: Uuid,
  /** The device's clock at send time; the server derives clock skew from it. */
  clientSentAt: z.iso.datetime(),
  events: z.array(OfflineJournalEventSchema).min(1).max(500),
})

export class OfflineSyncRequestDto implements z.infer<
  typeof OfflineSyncRequestSchema
> {
  static readonly schema = OfflineSyncRequestSchema
  declare attemptId: string
  declare clientSentAt: string
  declare events: OfflineJournalEvent[]
}

export type OfflineSyncRequest = z.infer<typeof OfflineSyncRequestSchema>
