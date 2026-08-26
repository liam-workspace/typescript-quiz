import type { PgPool } from "@liam-public/node-postgres"
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common"
import {
  findStudentBySubject,
  InvalidCursorError,
  listPublishedTests,
  loadTestBrief,
  type ListPublishedTestsResult,
  type TestBriefRow,
} from "@pp/db"
import { REQUEST_POOL } from "../database/tokens.js"

const MIN_LIMIT = 1
const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20

/**
 * A silently clamped limit would make a client's pagination arithmetic
 * wrong with no signal, so anything outside `1..50` is 400 rather than
 * rounded into range.
 */
function parseLimit(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_LIMIT
  }

  const value = Number(raw)

  if (!Number.isInteger(value) || value < MIN_LIMIT || value > MAX_LIMIT) {
    throw new BadRequestException("bad_limit")
  }

  return value
}

@Injectable()
export class CatalogService {
  constructor(@Inject(REQUEST_POOL) private readonly pool: PgPool) {}

  async list(
    subjectClaim: string,
    limitRaw: string | undefined,
    cursor: string | null,
  ): Promise<ListPublishedTestsResult> {
    const limit = parseLimit(limitRaw)
    const student = await findStudentBySubject(this.pool, subjectClaim)

    if (!student) {
      throw new NotFoundException("student_not_provisioned")
    }

    try {
      return await listPublishedTests(this.pool, {
        studentId: student.id,
        limit,
        cursor,
      })
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        throw new BadRequestException("bad_cursor")
      }

      throw error
    }
  }

  async getBrief(subjectClaim: string, slug: string): Promise<TestBriefRow> {
    const student = await findStudentBySubject(this.pool, subjectClaim)

    if (!student) {
      throw new NotFoundException("student_not_provisioned")
    }

    const brief = await loadTestBrief(this.pool, {
      slug,
      studentId: student.id,
    })

    if (!brief) {
      throw new NotFoundException("test_not_found")
    }

    return brief
  }
}
