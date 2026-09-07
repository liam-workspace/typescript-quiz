/**
 * The admin-only surface. `importTestDocument` and `exportTestDocument` live
 * here rather than the default barrel because `exportTestDocument` emits the
 * answer key (test-import.repository.ts pushes `isCorrect` onto every
 * choice) -- the same disclosure risk `@pp/db/scoring` fences `loadForScoring`
 * against. `AdminGuard` protects the route; this file is what stops a future
 * student-facing route from importing the function directly and getting the
 * key for free. `importTestDocument` carries no disclosure risk on its own,
 * but shares the module and an admin-only lifecycle, so it is fenced
 * alongside its counterpart rather than split out.
 *
 * `publishDraftVersion` and `resolveVersionId` belong to the same admin-only
 * lifecycle (import, publish, export) and have no other caller, so they are
 * exposed only from here too, never from the default barrel.
 *
 * `recordMediaAsset` joins them for the same reason, not a disclosure one:
 * `POST /admin/media` is admin-only and has no other caller either.
 */
import {
  exportTestDocument,
  importTestDocument,
} from "./repositories/test-import.repository.js"
import {
  DraftNotFoundError,
  publishDraftVersion,
  resolveVersionId,
  type PublishViolation,
} from "./repositories/publish.repository.js"
import {
  recordMediaAsset,
  type MediaAssetRow,
  type MediaKind,
} from "./repositories/media.repository.js"

export type { PublishViolation, MediaAssetRow, MediaKind }

export {
  DraftNotFoundError,
  exportTestDocument,
  importTestDocument,
  publishDraftVersion,
  recordMediaAsset,
  resolveVersionId,
}
