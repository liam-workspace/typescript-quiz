import { type DbConfig, loadDbConfig } from "./config.js"
import { createJobPool, createRequestPool } from "./pool.js"
import {
  finalizeExpiredAttempt,
  loadOwnedAttempt,
  loadRunningOwnedAttempt,
  startOrResumeAttempt,
  TestNotFoundError,
  type AttemptRow,
  type FinalizedAttemptRow,
  type StartResult,
} from "./repositories/attempt.repository.js"
import {
  InvalidCursorError,
  listPublishedTests,
  loadTestBrief,
  type ListPublishedTestsResult,
  type StudentSummary,
  type TestBriefRow,
  type TestCardRow,
} from "./repositories/catalog.repository.js"
import { loadForRunner } from "./repositories/test-version.repository.js"
import {
  findStudentBySubject,
  upsertStudentBySubject,
  type StudentRow,
} from "./repositories/student.repository.js"

export { migrateToLatest } from "./migrate.js"

export * from "./repositories/test-import.repository.js"

export type { DbConfig }

export type { StudentRow }

export type {
  ListPublishedTestsResult,
  StudentSummary,
  TestBriefRow,
  TestCardRow,
}

export type { AttemptRow, FinalizedAttemptRow, StartResult }

export {
  loadDbConfig,
  createJobPool,
  createRequestPool,
  loadForRunner,
  upsertStudentBySubject,
  findStudentBySubject,
  listPublishedTests,
  loadTestBrief,
  InvalidCursorError,
  loadOwnedAttempt,
  finalizeExpiredAttempt,
  loadRunningOwnedAttempt,
  startOrResumeAttempt,
  TestNotFoundError,
}
