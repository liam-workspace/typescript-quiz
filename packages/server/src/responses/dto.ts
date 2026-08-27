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
