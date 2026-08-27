import { type DbConfig, loadDbConfig } from "./config.js"
import { createJobPool, createRequestPool } from "./pool.js"
import {
  enterSection,
  finalizeExpiredAttempt,
  loadOwnedAttempt,
  loadRunningOwnedAttempt,
  startOrResumeAttempt,
  TestNotFoundError,
  type AttemptRow,
  type FinalizedAttemptRow,
  type SectionEntryRow,
  type StartResult,
} from "./repositories/attempt.repository.js"
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

export type { AttemptRow, FinalizedAttemptRow, SectionEntryRow, StartResult }

export type { RunnerEnvelopeRow }

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
  finalizeExpiredAttempt,
  loadRunningOwnedAttempt,
  startOrResumeAttempt,
  enterSection,
  TestNotFoundError,
}
