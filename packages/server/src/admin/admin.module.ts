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
    // Busboy's default of running the uploaded filename through
    // `basename()` is left ON. An earlier version disabled it so that an
    // e2e test could watch a traversing name reach this app's own defense
    // -- but that traded a real layer in production for a more legible
    // test. Both belong in production: `AdminService.uploadMedia` never
    // uses `originalname` as a path (it writes `<row id>.<ext>`), so the
    // defense is structural and unconditional, and busboy stripping first
    // costs nothing. The unconditional half is proved directly in
    // `admin.service` unit coverage, where a traversing `originalname` can
    // be handed in without a multipart parser in the way.
    MulterModule.registerAsync({
      useFactory: () => ({
        limits: { fileSize: loadServerConfig().mediaMaxBytes },
      }),
    }),
  ],
  controllers: [AdminController, AdminMediaController],
  providers: [AdminService],
})
export class AdminModule {}
