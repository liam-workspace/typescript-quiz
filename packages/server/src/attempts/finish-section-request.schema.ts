import { z } from "zod"
import { ResponseSnapshotItemSchema } from "../responses/dto.js"

export const FinishSectionRequestSchema = z.strictObject({
  clientInstanceId: z.string().min(1),
  responses: z.array(ResponseSnapshotItemSchema).optional(),
})

export class FinishSectionRequestDto implements z.infer<
  typeof FinishSectionRequestSchema
> {
  static readonly schema = FinishSectionRequestSchema
  declare clientInstanceId: string
  declare responses?: Array<z.infer<typeof ResponseSnapshotItemSchema>>
}

export type FinishSectionRequest = z.infer<typeof FinishSectionRequestSchema>
