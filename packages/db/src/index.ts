import { type DbConfig, loadDbConfig } from "./config.js"
import { createJobPool, createRequestPool } from "./pool.js"
import {
  enterSection,
  finalizeAttempt,
  finalizeExpiredAttempt,
  loadOwnedAttempt,
  loadRunningOwnedAttempt,
  setPosition,
  startOrResumeAttempt,
  submitAttempt,
  TestNotFoundError,
  type AttemptRow,
  type AttemptScoreRow,
  type FinalizedAttemptRow,
  type SectionEntryRow,
  type StartResult,
  type SubmitOutcome,
} from "./repositories/attempt.repository.js"
import { SectionExpiredError } from "./repositories/section-expired.error.js"
import {
  InvalidCursorError,
  listPublishedTests,
  loadSectionBrief,
  loadTestBrief,
  type ListPublishedTestsResult,
  type SectionBriefRow,
  type StudentSummary,
  type TestBriefRow,
  type TestCardRow,
} from "./repositories/catalog.repository.js"
import {
  insertFailedWrite,
  type FailedWriteRow,
} from "./repositories/failed-write.repository.js"
import {
  claimPlay,
  isFilenameCapped,
  type PlayClaimResult,
} from "./repositories/media-play.repository.js"
import {
  applyResponse,
  loadResponse,
  writeResponse,
  type ResponseWriteInput,
  type WriteOutcome,
} from "./repositories/response.repository.js"
import {
  loadQuestionSectionInfo,
  type QuestionSectionInfo,
} from "./repositories/section-lookup.repository.js"
import {
  loadRunnerEnvelope,
  type RunnerEnvelopeRow,
} from "./repositories/runner.repository.js"
import { loadForRunner } from "./repositories/test-version.repository.js"
import {
  findStudentBySubject,
  upsertStudentBySubject,
  type StudentRow,
} from "./repositories/student.repository.js"

export { migrateToLatest } from "./migrate.js"

export type { DbConfig }

export type { StudentRow }

export type {
  ListPublishedTestsResult,
  SectionBriefRow,
  StudentSummary,
  TestBriefRow,
  TestCardRow,
}

export type {
  AttemptRow,
  AttemptScoreRow,
  FinalizedAttemptRow,
  SectionEntryRow,
  StartResult,
  SubmitOutcome,
}

export type { RunnerEnvelopeRow }

export type { PlayClaimResult }

export type { FailedWriteRow }

export type { ResponseWriteInput, WriteOutcome }

export type { QuestionSectionInfo }

export {
  loadDbConfig,
  createJobPool,
  createRequestPool,
  loadForRunner,
  loadRunnerEnvelope,
  upsertStudentBySubject,
  findStudentBySubject,
  listPublishedTests,
  loadTestBrief,
  loadSectionBrief,
  InvalidCursorError,
  loadOwnedAttempt,
  finalizeAttempt,
  finalizeExpiredAttempt,
  loadRunningOwnedAttempt,
  SectionExpiredError,
  setPosition,
  startOrResumeAttempt,
  submitAttempt,
  enterSection,
  TestNotFoundError,
  claimPlay,
  isFilenameCapped,
  insertFailedWrite,
  loadResponse,
  writeResponse,
  applyResponse,
  loadQuestionSectionInfo,
}
