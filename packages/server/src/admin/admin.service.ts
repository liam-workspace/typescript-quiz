import type { PgPool } from "@liam-public/node-postgres"
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common"
import { testDocumentSchema, type Clock, type TestDocument } from "@pp/common"
import {
  DraftNotFoundError,
  exportTestDocument,
  importTestDocument,
  publishDraftVersion,
  resolveVersionId,
} from "@pp/db/admin"
import { CLOCK, JOB_POOL } from "../database/tokens.js"

export interface ImportResult {
  testId: string
  versionId: string
  version: number
}

export interface PublishResult {
  testId: string
  versionId: string
  version: number
  publishedAt: Date
}

/**
 * `version` in the query string is unvalidated user input. A value that is
 * not a positive integer is folded into a version number no draft or
 * published row can ever carry (`test_version_version_positive` requires
 * `version > 0`), rather than rejected with its own 400 -- the contract
 * declares exactly 401/403/404 for this operation, and "no such version"
 * is already the correct 404 for a bad number, not a distinct condition.
 */
const UNRESOLVABLE_VERSION = -1

function parseVersion(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined
  }

  const value = Number(raw)

  return Number.isInteger(value) && value > 0 ? value : UNRESOLVABLE_VERSION
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(JOB_POOL) private readonly pool: PgPool,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * `JOB_POOL`, not `REQUEST_POOL`: a 40-question import is exactly the long
   * statement the request path's 5s statement timeout would cancel
   * part-way through.
   */
  import(body: unknown): Promise<ImportResult> {
    const parsed = testDocumentSchema.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        message: "invalid_document",
        issues: parsed.error.issues,
      })
    }

    return importTestDocument(this.pool, parsed.data)
  }

  async publish(testId: string): Promise<PublishResult> {
    const result = await this.runPublish(testId)

    if (!result.ok) {
      throw new UnprocessableEntityException({
        // Repository `code` -> wire `rule`: the repository's PublishViolation
        // is an internal shape (see publish.repository.ts); the contract's
        // violation objects are flat and name the field `rule`.
        violations: result.violations.map((v) => ({
          rule: v.code,
          ...(v.questionId ? { questionId: v.questionId } : {}),
          ...(v.sectionId ? { sectionId: v.sectionId } : {}),
          detail: v.detail,
        })),
      })
    }

    return {
      testId,
      versionId: result.versionId,
      version: result.version,
      publishedAt: result.publishedAt,
    }
  }

  async export(
    testId: string,
    versionRaw: string | undefined,
  ): Promise<TestDocument> {
    const version = parseVersion(versionRaw)
    const versionId = await resolveVersionId(this.pool, { testId, version })

    if (!versionId) {
      throw new NotFoundException("test_not_found")
    }

    // `exportTestDocument` includes isCorrect on every choice, deliberately:
    // this route is guarded by the admin role claim, not by the field's
    // absence (spec §4). AdminGuard already ran before this call.
    return exportTestDocument(this.pool, versionId)
  }

  private async runPublish(
    testId: string,
  ): Promise<Awaited<ReturnType<typeof publishDraftVersion>>> {
    try {
      return await publishDraftVersion(this.pool, {
        testId,
        now: this.clock.now(),
      })
    } catch (error) {
      if (error instanceof DraftNotFoundError) {
        throw new NotFoundException("draft_not_found")
      }

      throw error
    }
  }
}
