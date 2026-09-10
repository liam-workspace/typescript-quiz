import { createReadStream, existsSync } from "node:fs"
import { extname, resolve, sep } from "node:path"
import type { PgPool } from "@liam-workspace/node-postgres"
import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  Query,
  StreamableFile,
  UseFilters,
} from "@nestjs/common"
import type { Clock } from "@pp/common"
import { isFilenameCapped } from "@pp/db"
import { ProblemException } from "../attempts/problem.exception.js"
import { ProblemExceptionFilter } from "../attempts/problem.filter.js"
import { loadServerConfig } from "../config.js"
import { CLOCK, REQUEST_POOL } from "../database/tokens.js"
import { verifyMediaSignature } from "./media-signing.js"

/**
 * By kind, not by the requested filename's extension or an upload's
 * declared MIME type -- the same rule `admin.service.ts`'s upload side
 * documents for the write half of this pair. `.mp3` is the only extension
 * this content model's fixtures and seed data actually use for audio; the
 * rest round out the two `media_kind` values this route can ever be asked
 * to serve.
 */
const MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
}

/**
 * No `JwksGuard`: an `<audio src>`/`<img src>` tag sends no bearer header,
 * so this route cannot sit behind one. The cap is enforced a different way
 * instead -- a capped filename demands a valid, unexpired `sig` (issued
 * only by `POST /play`); an uncapped one is safe to serve to anyone who
 * already knows its name, the same way a public asset URL always is.
 */
@Controller("media")
@UseFilters(ProblemExceptionFilter)
export class MediaController {
  constructor(
    @Inject(REQUEST_POOL) private readonly pool: PgPool,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get(":filename")
  async serve(
    @Param("filename") filename: string,
    @Query("exp") exp: string | undefined,
    @Query("sig") sig: string | undefined,
  ): Promise<StreamableFile> {
    const config = loadServerConfig()
    const mediaRootResolved = resolve(config.mediaRoot)
    const target = resolve(mediaRootResolved, filename)

    // Mirrors packages/web/vite.config.ts's `serveBranding`: resolve first,
    // then require the result to still be INSIDE mediaRoot, before any `fs`
    // call ever sees the caller-supplied path. `+ sep` (matching
    // admin.service.ts's `writeMediaFile` on the write side of this same
    // pair) is what stops `mediaRootResolved` itself being treated as a
    // prefix match for a sibling directory that merely starts with the same
    // characters.
    if (!target.startsWith(mediaRootResolved + sep)) {
      throw new ProblemException({
        type: "not_found",
        title: "No such media file.",
        status: HttpStatus.NOT_FOUND,
      })
    }

    const capped = await isFilenameCapped(this.pool, filename)

    if (capped) {
      const verified = verifyMediaSignature(
        filename,
        exp,
        sig,
        config.mediaSigningSecret,
        this.clock.now(),
      )

      if (!verified) {
        throw new ProblemException({
          type: "invalid_or_expired_signature",
          title: "The signature is invalid or expired.",
          status: HttpStatus.FORBIDDEN,
        })
      }
    }

    if (!existsSync(target)) {
      throw new ProblemException({
        type: "not_found",
        title: "No such media file.",
        status: HttpStatus.NOT_FOUND,
      })
    }

    return new StreamableFile(createReadStream(target), {
      type:
        MIME_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
    })
  }
}
