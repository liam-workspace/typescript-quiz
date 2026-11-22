import type { PgPool } from "@liam-workspace/node-postgres"
import { HttpStatus, Inject, Injectable } from "@nestjs/common"
import {
  findStudentBySubject,
  InvalidCursorError,
  listPublishedTests,
  loadOfflineBundle,
  loadTestBrief,
  type ListPublishedTestsResult,
  type OfflineBundleRow,
  type TestBriefRow,
} from "@pp/db"
import type { Clock } from "@pp/common"
import { ProblemException } from "../attempts/problem.exception.js"
import { loadServerConfig } from "../config.js"
import { CLOCK, REQUEST_POOL } from "../database/tokens.js"
import { signMediaUrl } from "../media/media-signing.js"
import { parseLimit } from "../pagination.js"

/** A saved test may be ~20 MB on a slow phone connection: give the download room. */
const BUNDLE_URL_TTL_MS = 30 * 60 * 1000

export interface OfflineBundleView extends Omit<OfflineBundleRow, "media"> {
  media: Array<OfflineBundleRow["media"][number] & { url: string }>
  urlsExpireAt: string
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(REQUEST_POOL) private readonly pool: PgPool,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

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

  async getOfflineBundle(
    subjectClaim: string,
    slug: string,
  ): Promise<OfflineBundleView> {
    const student = await findStudentBySubject(this.pool, subjectClaim)

    if (!student) {
      throw new ProblemException({
        type: "student_not_provisioned",
        title: "No student profile exists for this token.",
        status: HttpStatus.NOT_FOUND,
      })
    }

    const row = await loadOfflineBundle(this.pool, {
      slug,
      studentId: student.id,
    })

    if (!row) {
      throw new ProblemException({
        type: "test_not_found",
        title: "No such resource, or it is not published.",
        status: HttpStatus.NOT_FOUND,
      })
    }

    const expiresAt = new Date(this.clock.now().getTime() + BUNDLE_URL_TTL_MS)
    const { mediaSigningSecret } = loadServerConfig()

    return {
      ...row,
      media: row.media.map((item) => ({
        ...item,
        // ALWAYS signed for the download window. `capped` is judged per
        // stimulus here, but MediaController demands a signature per FILENAME
        // (`isFilenameCapped`: capped if ANY stimulus using the file is), so
        // an unsigned URL could 403. The route ignores a signature on a file
        // it does not consider capped.
        url: signMediaUrl(item.key, expiresAt, mediaSigningSecret),
      })),
      urlsExpireAt: expiresAt.toISOString(),
    }
  }
}
