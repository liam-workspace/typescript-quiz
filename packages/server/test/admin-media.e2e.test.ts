import { existsSync } from "node:fs"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AdminService } from "../src/admin/admin.service.js"
import { createTestApp, type TestApp } from "./helpers/app.js"

const SUB = "google-oauth2|media-test"
const EMAIL = "tom@example.com"

/**
 * `@types/superagent`'s `attach()` overload only types `{ filename?,
 * contentType? }` for its options object, but the `form-data` package
 * underneath honours `filepath` too (see the comment at its one call site
 * below). A separately-typed variable sidesteps the excess-property check
 * TypeScript would otherwise apply to an inline object literal, without
 * reaching for `as` on the call itself.
 */
interface AttachOptions {
  filename?: string
  filepath?: string
  contentType?: string
}

/**
 * `MEDIA_ROOT` and `MEDIA_MAX_BYTES` are read fresh by `loadServerConfig()`
 * wherever it is called (AdminModule's `MulterModule.registerAsync` factory,
 * AdminService.uploadMedia), never cached at import time -- see
 * session.service.ts's `allowedEmail` for the same pattern with
 * `ALLOWED_EMAILS`. Setting them before `createTestApp()` compiles the
 * module is enough; no harness change is needed. `MEDIA_MAX_BYTES` is kept
 * small (1KB) so the oversized-file test does not need a slow multi-MB
 * upload.
 */
describe("POST /admin/media", () => {
  let app: TestApp | undefined = undefined
  let mediaRoot = ""

  beforeAll(async () => {
    mediaRoot = await mkdtemp(join(tmpdir(), "pp-media-"))
    process.env.MEDIA_ROOT = mediaRoot
    process.env.MEDIA_MAX_BYTES = "1024"

    app = await createTestApp()
  })

  afterAll(async () => {
    await app?.close()
    await rm(mediaRoot, { recursive: true, force: true })
    delete process.env.MEDIA_ROOT
    delete process.env.MEDIA_MAX_BYTES
  })

  function ready(): TestApp {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    return app
  }

  function adminToken(suffix: string): Promise<string> {
    return ready().mint({
      sub: `${SUB}-${suffix}`,
      email: EMAIL,
      isAdmin: true,
    })
  }

  it("accepts an mp3 and returns its id", async () => {
    const a = ready()
    const token = await adminToken("accept")
    const bytes = Buffer.from("fake-mp3-bytes")

    const res = await request(a.http.getHttpServer() as App)
      .post("/api/admin/media")
      .set("Authorization", `Bearer ${token}`)
      .field("kind", "audio")
      .attach("file", bytes, "song.mp3")
      .expect(201)

    const body = res.body as {
      id: string
      kind: string
      filename: string
      mimeType: string
      byteSize: number
      checksum: string
    }

    expect(typeof body.id).toBe("string")
    expect(body.kind).toBe("audio")
    expect(body.filename).toBe("song.mp3")
    expect(body.mimeType).toBe("audio/mpeg")
    // `byte_size` is `bigint` in Postgres -- node-postgres would hand back a
    // string, so this is the assertion that the repository boundary
    // actually converted it (media.repository.ts's `toMediaAsset`).
    expect(typeof body.byteSize).toBe("number")
    expect(body.byteSize).toBe(bytes.length)
    expect(typeof body.checksum).toBe("string")

    const files = await readdir(mediaRoot)

    expect(files).toContain(`${body.id}.audio`)
  })

  it("rejects an oversized file with 413", async () => {
    const a = ready()
    const token = await adminToken("oversized")
    const big = Buffer.alloc(2000, "a")

    await request(a.http.getHttpServer() as App)
      .post("/api/admin/media")
      .set("Authorization", `Bearer ${token}`)
      .field("kind", "audio")
      .attach("file", big, "big.mp3")
      .expect(413)
  })

  it("rejects a duplicate filename with 409", async () => {
    const a = ready()
    const token = await adminToken("dup")

    await request(a.http.getHttpServer() as App)
      .post("/api/admin/media")
      .set("Authorization", `Bearer ${token}`)
      .field("kind", "audio")
      .attach("file", Buffer.from("first"), "dup.mp3")
      .expect(201)

    await request(a.http.getHttpServer() as App)
      .post("/api/admin/media")
      .set("Authorization", `Bearer ${token}`)
      .field("kind", "audio")
      .attach("file", Buffer.from("second"), "dup.mp3")
      .expect(409)
  })

  it("rejects a kind outside the media_kind enum with 415", async () => {
    const a = ready()
    const token = await adminToken("badkind")

    await request(a.http.getHttpServer() as App)
      .post("/api/admin/media")
      .set("Authorization", `Bearer ${token}`)
      .field("kind", "video")
      .attach("file", Buffer.from("bytes"), "clip.mp4")
      .expect(415)
  })

  it("rejects a MIME type that does not match the declared kind with 415", async () => {
    const a = ready()
    const token = await adminToken("mimemismatch")

    await request(a.http.getHttpServer() as App)
      .post("/api/admin/media")
      .set("Authorization", `Bearer ${token}`)
      .field("kind", "audio")
      .attach("file", Buffer.from("<html></html>"), {
        filename: "not-audio.mp3",
        contentType: "text/html",
      })
      .expect(415)
  })

  it("rejects a non-admin token with 403", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-nonadmin`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/api/admin/media")
      .set("Authorization", `Bearer ${token}`)
      .field("kind", "audio")
      .attach("file", Buffer.from("bytes"), "no.mp3")
      .expect(403)
  })

  it("is 401 without a token", async () => {
    const a = ready()

    await request(a.http.getHttpServer() as App)
      .post("/api/admin/media")
      .field("kind", "audio")
      .attach("file", Buffer.from("bytes"), "anon.mp3")
      .expect(401)
  })

  it("admits an admin token, and a traversing filename never reaches the filesystem", async () => {
    const a = ready()
    const token = await adminToken("traversal")

    // `filepath`, not `filename`: the `form-data` package that backs
    // supertest's `.attach()` runs `filename` through `path.basename`
    // before it ever leaves the client (a courtesy the real attacker this
    // test models has no reason to extend). `filepath` instead goes
    // through `path.normalize`, which leaves a leading `../../` intact --
    // there is nothing before it to collapse against -- so the raw
    // traversal string is what actually crosses the wire and reaches
    // busboy's parsing, which is what this test needs to prove safe.
    const traversalAttachment: AttachOptions = {
      filepath: "../../evil.mp3",
      contentType: "audio/mpeg",
    }

    const res = await request(a.http.getHttpServer() as App)
      .post("/api/admin/media")
      .set("Authorization", `Bearer ${token}`)
      .field("kind", "audio")
      .attach("file", Buffer.from("evil-bytes"), traversalAttachment)
      .expect(201)

    const body = res.body as { id: string; filename: string }

    // Busboy's basename() default strips the traversal before this app sees
    // it -- a real layer, deliberately left on. The metadata therefore holds
    // the stripped name.
    expect(body.filename).toBe("evil.mp3")

    // ...and the stored path is derived from the server-generated id, so
    // the traversal never reaches the filesystem as a path.
    const files = await readdir(mediaRoot)

    expect(files).toContain(`${body.id}.audio`)

    const oneLevelUp = resolve(mediaRoot, "..", "evil.mp3")
    const twoLevelsUp = resolve(mediaRoot, "..", "..", "evil.mp3")

    expect(existsSync(oneLevelUp)).toBe(false)
    expect(existsSync(twoLevelsUp)).toBe(false)
  })

  it("ignores a traversing originalname even with no parser in the way", async () => {
    const a = ready()

    // The case above proves the HTTP path is safe, but only because busboy
    // strips first -- it cannot show what this app would do with a name that
    // got past the parser. Calling the service directly removes that
    // ambiguity: `uploadMedia` never uses `originalname` as a path, so the
    // defense holds whether or not anything stripped it earlier. If busboy's
    // default ever changes, this is the test that still fails.
    const service = a.get(AdminService)
    const result = await service.uploadMedia("audio", {
      originalname: "../../../escaped.mp3",
      mimetype: "audio/mpeg",
      buffer: Buffer.from("evil-bytes"),
    })

    const files = await readdir(mediaRoot)

    expect(files).toContain(`${result.id}.audio`)
    expect(files).not.toContain("escaped.mp3")
    expect(
      existsSync(resolve(mediaRoot, "..", "..", "..", "escaped.mp3")),
    ).toBe(false)
  })
})
