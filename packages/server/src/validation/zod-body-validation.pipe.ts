import {
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from "@nestjs/common"
import type { ZodType } from "zod"

/**
 * Thrown by anything on the write path that rejects a whole request body --
 * this pipe on schema failure, and Task 6's flush service on `mixed_sections`
 * / `empty_batch`. One type so FailedWriteCaptureFilter has one thing to
 * catch rather than a growing union.
 */
export class CapturableBadRequestException extends Error {
  constructor(
    public readonly reason: string,
    public readonly detail: string,
  ) {
    super(reason)
  }
}

interface ZodDtoMetatype {
  schema?: ZodType
}

/**
 * This repository's validation library is Zod (already `@pp/server`'s
 * dependency), not class-validator. A DTO class exposes a static `schema`
 * so Nest's constructor-parameter reflection (`design:paramtypes`) still
 * tells this pipe WHICH schema applies to a given @Body() parameter --
 * the same mechanism the built-in ValidationPipe uses, aimed at Zod
 * instead. Registered globally via app.useGlobalPipes, so it runs before
 * every controller handler, which is the hazard spec §7 names.
 */
@Injectable()
export class ZodBodyValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== "body") {
      return value
    }

    const metatype = metadata.metatype as ZodDtoMetatype | undefined
    const schema = metatype?.schema

    if (!schema) {
      return value
    }

    const result = schema.safeParse(value)

    if (!result.success) {
      const { issues } = result.error
      const reason =
        issues.length === 1 && issues[0].message === "empty_batch"
          ? "empty_batch"
          : "invalid_body"
      throw new CapturableBadRequestException(reason, JSON.stringify(issues))
    }

    return result.data
  }
}
