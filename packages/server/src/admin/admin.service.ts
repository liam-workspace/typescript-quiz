import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { withTransaction, type PgPool } from "@liam-workspace/node-postgres"
import { HttpStatus, Inject, Injectable } from "@nestjs/common"
import {
  adminPaginationSchema,
  adminTestFilterSchema,
  draftQuestionPatchSchema,
  testDocumentSchema,
  type AdminAttemptDetail,
  type AdminLearnerPage,
  type AdminOverview,
  type AdminQuestion,
  type AdminQuestionPage,
  type AdminResultPage,
  type AdminResultRollups,
  type AdminTestDetail,
  type AdminTestPage,
  type Clock,
  type TestDocument,
} from "@pp/common"
import { InvalidCursorError } from "@pp/db"
import { z } from "zod"
import {
  AmbiguousDraftTextError,
  DraftNotFoundError,
  DraftQuestionNotFoundError,
  InvalidDraftChoicesError,
  PublishedVersionMutationError,
  exportTestDocument,
  importTestDocument,
  importApprovedMathCandidates,
  InvalidMathCandidateImportError,
  listAdminLearners,
  listAdminQuestions,
  listAdminResults,
  listAdminTests,
  loadAdminAttemptDetail,
  loadAdminOverview,
  loadAdminResultRollups,
  loadAdminTestDetail,
  patchDraftQuestion,
  publishDraftVersion,
  recordMediaAsset,
  resolveVersionId,
  type MediaAssetRow,
  type MediaKind,
} from "@pp/db/admin"
import { ProblemException } from "../attempts/problem.exception.js"
import { CLOCK, JOB_POOL, REQUEST_POOL } from "../database/tokens.js"
import { loadServerConfig } from "../config.js"

const mathImportText = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.isWellFormed() && !value.includes("\0"))

const mathImportSchema = z.strictObject({
  candidateIds: z
    .array(z.uuid())
    .min(1)
    .refine(
      (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
      "Select each candidate only once",
    ),
  title: mathImportText,
  slug: mathImportText,
  durationSeconds: testDocumentSchema.shape.durationSeconds.max(2147483647),
  level: testDocumentSchema.shape.level,
})

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

export interface UploadMediaResult {
  id: string
  kind: MediaKind
  filename: string
  mimeType: string
  byteSize: number
  checksum: string
}

/**
 * Multer's in-memory storage engine (no `dest`/`storage` option -- see
 * `MulterModule.registerAsync` in admin.module.ts) hands the controller
 * exactly this shape. Declared locally rather than reaching for the
 * `Express.Multer.File` global namespace: `@types/multer` is not installed,
 * since nothing else in this repo touches file upload.
 */
export interface MulterFile {
  originalname: string
  mimetype: string
  buffer: Buffer
}

/**
 * One rule set per accepted `media_kind` value, in one object literal so
 * the enum's members are stated exactly once here rather than restated
 * across a kind check, a MIME-prefix check and an extension table: the
 * keys double as the "is this a legal kind" set, and each entry supplies
 * both the accepted MIME prefix and the on-disk extension.
 *
 * The extension is the kind name itself, not sniffed from the upload's
 * MIME subtype -- a `.audio`/`.image` file on disk never claims a format
 * more specific than what this route actually validated. Nothing
 * downstream needs a real extension either: `/media` (plan 3) pins its
 * served Content-Type from `kind`, never from the filename or the
 * upload's declared MIME type.
 */
/**
 * The inverse of `media.controller.ts`'s MIME_TYPES, and it has to stay that
 * way: the serving route picks a Content-Type from the stored file's
 * EXTENSION, so an extension it does not know is served as
 * application/octet-stream and an `<audio>` element silently refuses to play
 * it. Storing a placeholder extension (`.audio`, `.image`) produced exactly
 * that -- a file that uploaded fine, served 200, and would not play.
 *
 * Whitelisting here also sharpens the 415: a `mimePrefix` check alone accepts
 * `audio/flac`, which then stores as something unplayable rather than being
 * refused up front.
 */
const EXTENSION_BY_MIME: Record<
  string,
  { kind: MediaKind; extension: string } | undefined
> = {
  "audio/mpeg": { kind: "audio", extension: "mp3" },
  "audio/wav": { kind: "audio", extension: "wav" },
  "image/png": { kind: "image", extension: "png" },
  "image/jpeg": { kind: "image", extension: "jpg" },
  "image/webp": { kind: "image", extension: "webp" },
}

const MEDIA_KINDS: readonly MediaKind[] = ["audio", "image"]

function isMediaKind(value: unknown): value is MediaKind {
  // Checked against the enum's own members rather than a lookup table's keys,
  // so the accepted set cannot drift when that table changes shape.
  return typeof value === "string" && MEDIA_KINDS.includes(value as MediaKind)
}

const UNIQUE_VIOLATION_SQLSTATE = "23505"
const MEDIA_FILENAME_CONSTRAINT = "media_asset_filename_key"

/**
 * `filename` is `UNIQUE` in the schema. Overwriting on a duplicate would
 * mutate content a published version already cites, so the write must
 * fail instead -- see media.repository.ts.
 */
function isDuplicateFilename(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false
  }

  const { code, constraint } = error as {
    code?: unknown
    constraint?: unknown
  }

  return (
    code === UNIQUE_VIOLATION_SQLSTATE &&
    constraint === MEDIA_FILENAME_CONSTRAINT
  )
}

function toUploadResult(row: MediaAssetRow): UploadMediaResult {
  return {
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    checksum: row.checksum,
  }
}

/**
 * The stored path is derived only from the server-generated `id` plus a
 * whitelisted extension -- never from the client-supplied `filename` --
 * so a traversing name (`../../etc/passwd`, an absolute path, a name with
 * a NUL byte) never reaches the filesystem; `filename` is stored as
 * metadata only (media.repository.ts). Resolving and prefix-checking the
 * final path is insurance against a future change to that derivation, not
 * the primary defense.
 */
async function writeMediaFile(
  mediaRootResolved: string,
  storedName: string,
  buffer: Buffer,
): Promise<void> {
  const target = resolve(mediaRootResolved, storedName)

  if (!target.startsWith(mediaRootResolved + sep)) {
    throw new Error(`resolved media path escaped mediaRoot: ${target}`)
  }

  await mkdir(mediaRootResolved, { recursive: true })
  await writeFile(target, buffer)
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const pageQueryShape = {
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(adminPaginationSchema.shape.limit)
    .default(20),
  cursor: adminPaginationSchema.shape.cursor.default(null),
}
const testQuerySchema = adminTestFilterSchema.extend(pageQueryShape)
const questionQuerySchema = adminTestFilterSchema
  .pick({ search: true })
  .extend({
    ...pageQueryShape,
    testId: z.string().regex(UUID_PATTERN).optional(),
  })

const resultQuerySchema = z.strictObject({
  ...pageQueryShape,
  testId: z.string().regex(UUID_PATTERN).optional(),
  learnerId: z.string().regex(UUID_PATTERN).optional(),
})
const rollupQuerySchema = resultQuerySchema.pick({ limit: true, testId: true })
const learnerQuerySchema = adminTestFilterSchema
  .pick({ search: true })
  .extend(pageQueryShape)

function parseAdminQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  const parsed = schema.safeParse(query)

  if (!parsed.success) {
    throw new ProblemException({
      type: "invalid_query",
      title: "The query parameters failed validation.",
      status: HttpStatus.BAD_REQUEST,
      issues: parsed.error.issues,
    })
  }

  return parsed.data
}

async function readAdminPage<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
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

function testNotFound(): ProblemException {
  return new ProblemException({
    type: "test_not_found",
    title: "No such test exists.",
    status: HttpStatus.NOT_FOUND,
  })
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(JOB_POOL) private readonly pool: PgPool,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(REQUEST_POOL) private readonly readPool: PgPool,
  ) {}

  overview(): Promise<AdminOverview> {
    return loadAdminOverview(this.readPool, {})
  }

  listTests(query: Record<string, unknown>): Promise<AdminTestPage> {
    const parsed = parseAdminQuery(testQuerySchema, query)

    return readAdminPage(() => listAdminTests(this.readPool, parsed))
  }

  async testDetail(testId: string): Promise<AdminTestDetail> {
    if (!UUID_PATTERN.test(testId)) {
      throw testNotFound()
    }

    const detail = await loadAdminTestDetail(this.readPool, testId)

    if (!detail) {
      throw testNotFound()
    }

    return detail
  }

  listQuestions(query: Record<string, unknown>): Promise<AdminQuestionPage> {
    const parsed = parseAdminQuery(questionQuerySchema, query)

    return readAdminPage(() => listAdminQuestions(this.readPool, parsed))
  }

  async patchDraftQuestion(
    versionId: string,
    questionId: string,
    body: unknown,
    adminSubject: string,
  ): Promise<AdminQuestion> {
    if (!UUID_PATTERN.test(versionId) || !UUID_PATTERN.test(questionId)) {
      throw new ProblemException({
        type: "draft_question_not_found",
        title: "No such draft question exists in this version.",
        status: HttpStatus.NOT_FOUND,
      })
    }

    const parsed = draftQuestionPatchSchema.safeParse(body)

    if (!parsed.success) {
      throw new ProblemException({
        type: "invalid_draft_question_patch",
        title: "The draft question patch failed validation.",
        status: HttpStatus.BAD_REQUEST,
        issues: parsed.error.issues,
      })
    }

    const question = await patchDraftQuestion(this.readPool, {
      versionId,
      questionId,
      patch: parsed.data,
    }).catch((error: unknown) => {
      if (error instanceof DraftQuestionNotFoundError) {
        throw new ProblemException({
          type: "draft_question_not_found",
          title: "No such draft question exists in this version.",
          status: HttpStatus.NOT_FOUND,
        })
      }

      if (error instanceof PublishedVersionMutationError) {
        throw new ProblemException({
          type: "published_version_immutable",
          title: "Published versions cannot be edited.",
          status: HttpStatus.CONFLICT,
        })
      }

      if (error instanceof AmbiguousDraftTextError) {
        throw new ProblemException({
          type: "ambiguous_draft_text",
          title:
            "Flat editing cannot safely modify rich content with multiple text blocks.",
          status: HttpStatus.CONFLICT,
        })
      }

      if (error instanceof InvalidDraftChoicesError) {
        throw new ProblemException({
          type: "invalid_draft_choices",
          title: "Choices must retain the question's existing choice IDs.",
          status: HttpStatus.BAD_REQUEST,
        })
      }

      throw error
    })

    // The repository transaction has committed. Await the append before
    // returning success; an audit failure returns 500 but cannot undo the edit.
    await this.readPool.query(
      `INSERT INTO admin_audit_log
         (admin_subject, action, resource_type, resource_id, metadata)
       VALUES ($1, 'draft_question_updated', 'question', $2, $3::jsonb)`,
      [adminSubject, questionId, JSON.stringify({ versionId })],
    )

    return question
  }

  listResults(query: Record<string, unknown>): Promise<AdminResultPage> {
    const parsed = parseAdminQuery(resultQuerySchema, query)

    return readAdminPage(() => listAdminResults(this.readPool, parsed))
  }

  resultRollups(query: Record<string, unknown>): Promise<AdminResultRollups> {
    return loadAdminResultRollups(
      this.readPool,
      parseAdminQuery(rollupQuerySchema, query),
    )
  }

  async attemptDetail(
    attemptId: string,
    adminSubject: string,
  ): Promise<AdminAttemptDetail> {
    const detail = UUID_PATTERN.test(attemptId)
      ? await loadAdminAttemptDetail(this.readPool, attemptId)
      : null

    if (!detail) {
      throw new ProblemException({
        type: "attempt_not_found",
        title: "No such completed attempt exists.",
        status: HttpStatus.NOT_FOUND,
      })
    }

    // Await the immutable audit append before disclosing the retrieved answers.
    // A failed append fails the request; denied/missing reads never reach it.
    await this.readPool.query(
      `INSERT INTO admin_audit_log
         (admin_subject, action, resource_type, resource_id)
       VALUES ($1, 'attempt_detail_viewed', 'attempt', $2)`,
      [adminSubject, attemptId],
    )

    return detail
  }

  listLearners(query: Record<string, unknown>): Promise<AdminLearnerPage> {
    const parsed = parseAdminQuery(learnerQuerySchema, query)

    return readAdminPage(() => listAdminLearners(this.readPool, parsed))
  }

  /**
   * `JOB_POOL`, not `REQUEST_POOL`: a 40-question import is exactly the long
   * statement the request path's 5s statement timeout would cancel
   * part-way through.
   */
  import(body: unknown): Promise<ImportResult> {
    const parsed = testDocumentSchema.safeParse(body)

    if (!parsed.success) {
      throw new ProblemException({
        type: "invalid_document",
        title: "The document failed validation.",
        status: HttpStatus.BAD_REQUEST,
        issues: parsed.error.issues,
      })
    }

    return importTestDocument(this.pool, parsed.data)
  }

  async importApprovedMathCandidates(
    body: unknown,
    adminSubject: string,
  ): Promise<ImportResult> {
    const parsed = mathImportSchema.safeParse(body)

    if (!parsed.success) {
      throw new ProblemException({
        type: "invalid_math_import",
        title: "The math import request failed validation.",
        status: HttpStatus.BAD_REQUEST,
        issues: parsed.error.issues,
      })
    }

    try {
      return await importApprovedMathCandidates(this.pool, {
        ...parsed.data,
        adminSubject,
      })
    } catch (error) {
      if (error instanceof InvalidMathCandidateImportError) {
        throw new ProblemException({
          type: "invalid_candidate_selection",
          title: error.message,
          status: HttpStatus.CONFLICT,
        })
      }

      throw error
    }
  }

  async publish(testId: string): Promise<PublishResult> {
    const result = await this.runPublish(testId)

    if (!result.ok) {
      throw new ProblemException({
        type: "validation_failed",
        title: "Content validation failed; the version stays a draft.",
        status: HttpStatus.UNPROCESSABLE_ENTITY,
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
      throw new ProblemException({
        type: "test_not_found",
        title: "No such resource, or it is not published.",
        status: HttpStatus.NOT_FOUND,
      })
    }

    // `exportTestDocument` includes isCorrect on every choice, deliberately:
    // this route is guarded by the admin role claim, not by the field's
    // absence (spec §4). AdminGuard already ran before this call.
    return exportTestDocument(this.pool, versionId)
  }

  /**
   * `JOB_POOL`, not `REQUEST_POOL`: a checksum over the whole upload plus a
   * filesystem write are not the sub-5s request-path work `REQUEST_POOL`'s
   * statement timeout assumes.
   *
   * Ordering, coordinated by one transaction (see media.repository.ts):
   * INSERT the row first -- a duplicate `filename` surfaces as the 409
   * here, before any bytes are written -- then stream the file, then let
   * the transaction commit. A failure writing the file rolls the INSERT
   * back too, so there is never a row with no file. A failure committing
   * after a successful write leaves only an orphaned file: invisible,
   * harmless, cleanable later. Row-first would risk the opposite -- a
   * dangling row, which is a broken reference in every export.
   */
  async uploadMedia(
    kindInput: unknown,
    file: MulterFile | undefined,
  ): Promise<UploadMediaResult> {
    if (!isMediaKind(kindInput) || !file) {
      throw new ProblemException({
        type: "unsupported_kind",
        title: "Unsupported media type.",
        status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      })
    }

    const kind = kindInput
    const rules = EXTENSION_BY_MIME[file.mimetype.toLowerCase()]

    if (!rules || rules.kind !== kind) {
      throw new ProblemException({
        type: "mime_kind_mismatch",
        title: "Unsupported media type.",
        status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      })
    }

    // Computed server-side. A client-supplied checksum is trusted by
    // nobody -- it is the one thing this route exists to make trustworthy.
    const checksum = createHash("sha256").update(file.buffer).digest("hex")
    const mediaRootResolved = resolve(loadServerConfig().mediaRoot)
    const storedName = `${checksum}.${rules.extension}`

    try {
      const row = await withTransaction(this.pool, async (tx) => {
        const inserted = await recordMediaAsset(tx, {
          kind,
          // Content-addressed, and the SAME name the file gets on disk.
          // `media_asset.filename` is the locator: the runner emits
          // `/media/<filename>`, claimPlay looks a stimulus up by it, and
          // `/media/:filename` resolves it under mediaRoot. Storing the
          // client's `originalname` here while writing the bytes somewhere
          // else broke that invariant -- every signed URL pointed at a file
          // that was never written under that name.
          //
          // The checksum rather than the row id because the id is not known
          // until this INSERT returns, and because it makes the UNIQUE
          // constraint mean something real: identical bytes collide, so the
          // 409 now reports a duplicate UPLOAD rather than a coincidence of
          // author-chosen names.
          filename: storedName,
          mimeType: file.mimetype,
          byteSize: file.buffer.length,
          checksum,
        })

        await writeMediaFile(mediaRootResolved, storedName, file.buffer)

        return inserted
      })

      return toUploadResult(row)
    } catch (error) {
      if (isDuplicateFilename(error)) {
        throw new ProblemException({
          type: "duplicate_filename",
          title: "A media file with these exact bytes already exists.",
          status: HttpStatus.CONFLICT,
        })
      }

      throw error
    }
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
        throw new ProblemException({
          type: "draft_not_found",
          title: "No such resource, or it is not published.",
          status: HttpStatus.NOT_FOUND,
        })
      }

      throw error
    }
  }
}
