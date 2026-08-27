import { Module } from "@nestjs/common"
import { MulterModule } from "@nestjs/platform-express"
import { loadServerConfig } from "../config.js"
import { AdminController, AdminMediaController } from "./admin.controller.js"
import { AdminService } from "./admin.service.js"

@Module({
  imports: [
    // Memory storage (no `dest`/`storage` given): the upload is hashed and
    // written to `config.mediaRoot` by AdminService, never left on disk by
    // multer itself. `limits.fileSize` is what turns an oversized upload
    // into multer's own `LIMIT_FILE_SIZE` error, which
    // `@nestjs/platform-express` maps to `PayloadTooLargeException` (413)
    // before the controller ever runs -- see `transformException` in
    // `@nestjs/platform-express/multer/multer/multer.utils.js`.
    //
    // `preservePath: true` turns OFF busboy's own default of running the
    // uploaded filename through `basename()` (see
    // `busboy/lib/types/multipart.js`). That default would otherwise
    // silently absorb a traversal attempt before AdminService ever saw it
    // -- true, but only as an accident of this particular multipart
    // parser, not because this codebase decided a traversing name is
    // safe. The actual defense is AdminService.uploadMedia: `filename` is
    // stored as inert metadata and never used to build a filesystem path
    // (see media.repository.ts and the resolve-and-prefix-check in
    // admin.service.ts). Disabling busboy's stripping is what lets that
    // defense be the one under test, rather than one this app does not
    // control.
    MulterModule.registerAsync({
      useFactory: () => ({
        preservePath: true,
        limits: { fileSize: loadServerConfig().mediaMaxBytes },
      }),
    }),
  ],
  controllers: [AdminController, AdminMediaController],
  providers: [AdminService],
})
export class AdminModule {}
