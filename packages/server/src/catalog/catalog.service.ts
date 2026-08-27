import type { PgPool } from "@liam-public/node-postgres"
import { HttpStatus, Inject, Injectable } from "@nestjs/common"
import {
  findStudentBySubject,
  InvalidCursorError,
  listPublishedTests,
  loadTestBrief,
  type ListPublishedTestsResult,
  type TestBriefRow,
} from "@pp/db"
import { ProblemException } from "../attempts/problem.exception.js"
import { REQUEST_POOL } from "../database/tokens.js"
import { parseLimit } from "../pagination.js"

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
      throw new ProblemException({
        type: "student_not_provisioned",
        title: "No student profile exists for this token.",
        status: HttpStatus.NOT_FOUND,
      })
    }

    try {
      return await listPublishedTests(this.pool, {
        studentId: student.id,
        limit,
        cursor,
      })
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        throw new ProblemException({
          type: "bad_cursor",
          title: "The cursor could not be decoded.",
          status: HttpStatus.BAD_REQUEST,
        })
      }

      throw error
    }
  }

  async getBrief(subjectClaim: string, slug: string): Promise<TestBriefRow> {
    const student = await findStudentBySubject(this.pool, subjectClaim)

    if (!student) {
      throw new ProblemException({
        type: "student_not_provisioned",
        title: "No student profile exists for this token.",
        status: HttpStatus.NOT_FOUND,
      })
    }

    const brief = await loadTestBrief(this.pool, {
      slug,
      studentId: student.id,
    })

    if (!brief) {
      throw new ProblemException({
        type: "test_not_found",
        title: "No such resource, or it is not published.",
        status: HttpStatus.NOT_FOUND,
      })
    }

    return brief
  }
}
