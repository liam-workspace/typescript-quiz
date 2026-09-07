import { z } from "zod"
import { ResponseSnapshotItemSchema } from "../responses/dto.js"

export const SubmitRequestSchema = z.strictObject({
  clientInstanceId: z.string().min(1),
  responses: z.array(ResponseSnapshotItemSchema).optional(),
})

export class SubmitRequestDto implements z.infer<typeof SubmitRequestSchema> {
  static readonly schema = SubmitRequestSchema
  declare clientInstanceId: string
  declare responses?: Array<z.infer<typeof ResponseSnapshotItemSchema>>
}

export type SubmitRequest = z.infer<typeof SubmitRequestSchema>
