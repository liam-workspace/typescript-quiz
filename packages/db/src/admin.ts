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
  importApprovedMathCandidates,
  InvalidMathCandidateImportError,
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
import {
  listAdminLearners,
  listAdminQuestions,
  listAdminResults,
  listAdminTests,
  loadAdminAttemptDetail,
  loadAdminOverview,
  loadAdminResultRollups,
  loadAdminTestDetail,
} from "./repositories/admin-read.repository.js"
import {
  AmbiguousDraftTextError,
  DraftQuestionNotFoundError,
  InvalidDraftChoicesError,
  PublishedVersionMutationError,
  patchDraftQuestion,
} from "./repositories/admin-draft.repository.js"

import {
  CandidateReviewError,
  claimQueuedGenerationRequest,
  completeGenerationRequest,
  createGenerationRequest,
  insertGenerationCandidate,
  listCandidates,
  listGenerationRequests,
  loadCandidateDetail,
  renewGenerationClaim,
  reviewCandidate,
  type CandidateDetail,
  type CandidatePresentation,
  type GenerationClaim,
  type CandidateSummary,
  type GenerationCandidateInput,
  type GenerationRequest,
  type GenerationRequestInput,
} from "./repositories/math-generation.repository.js"

export type {
  PublishViolation,
  MediaAssetRow,
  MediaKind,
  CandidateDetail,
  CandidatePresentation,
  GenerationClaim,
  CandidateSummary,
  GenerationCandidateInput,
  GenerationRequest,
  GenerationRequestInput,
}

export {
  CandidateReviewError,
  claimQueuedGenerationRequest,
  completeGenerationRequest,
  createGenerationRequest,
  insertGenerationCandidate,
  listCandidates,
  listGenerationRequests,
  loadCandidateDetail,
  renewGenerationClaim,
  reviewCandidate,
  AmbiguousDraftTextError,
  DraftNotFoundError,
  DraftQuestionNotFoundError,
  InvalidDraftChoicesError,
  PublishedVersionMutationError,
  exportTestDocument,
  importTestDocument,
  importApprovedMathCandidates,
  InvalidMathCandidateImportError,
  publishDraftVersion,
  recordMediaAsset,
  resolveVersionId,
  listAdminLearners,
  listAdminQuestions,
  listAdminResults,
  listAdminTests,
  loadAdminAttemptDetail,
  loadAdminOverview,
  loadAdminResultRollups,
  loadAdminTestDetail,
  patchDraftQuestion,
}
