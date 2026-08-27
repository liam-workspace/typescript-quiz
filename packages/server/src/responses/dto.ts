import { z } from "zod"

export const SingleResponseWriteSchema = z.strictObject({
  clientInstanceId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  selectedChoiceIds: z.array(z.string()),
  answeredAt: z.iso.datetime().optional(),
  timeSpentMs: z.number().int().nonnegative().optional(),
})

export class SingleResponseWriteDto implements z.infer<
  typeof SingleResponseWriteSchema
> {
  static readonly schema = SingleResponseWriteSchema
  declare clientInstanceId: string
  declare seq: number
  declare selectedChoiceIds: string[]
  declare answeredAt?: string
  declare timeSpentMs?: number
}

const UuidStringSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "invalid_uuid",
  )

export const ResponseSnapshotQuestionIdentitySchema = z.object({
  questionId: UuidStringSchema,
})

export const ResponseSnapshotItemSchema = z.strictObject({
  questionId: UuidStringSchema,
  seq: z.number().int().nonnegative(),
  selectedChoiceIds: z
    .array(UuidStringSchema)
    .refine(
      (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
      "duplicate_choice",
    ),
  answeredAt: z.iso.datetime().optional(),
  timeSpentMs: z.number().int().nonnegative().max(2_147_483_647).optional(),
})

export const ResponseSnapshotSchema = z.strictObject({
  clientInstanceId: z.string().min(1),
  // Validate only the identity needed to return one acknowledgement per
  // item here. Full item validation happens inside the controller so one
  // malformed answer cannot reject the whole snapshot.
  responses: z
    .array(z.looseObject({ questionId: z.string() }))
    .min(1, "empty_batch"),
})

export class ResponseSnapshotDto implements z.infer<
  typeof ResponseSnapshotSchema
> {
  static readonly schema = ResponseSnapshotSchema
  declare clientInstanceId: string
  declare responses: Array<
    z.infer<typeof ResponseSnapshotSchema>["responses"][number]
  >
}
