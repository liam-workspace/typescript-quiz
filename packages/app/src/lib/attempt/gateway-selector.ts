import type { AttemptGateway } from "./attempt-gateway.js"
import { RemoteAttemptGateway } from "./remote-gateway.js"

let current: AttemptGateway = new RemoteAttemptGateway()

/**
 * Installs the gateway pages will use. The default is the remote gateway, so
 * tests (and any code path that never installs another one) behave exactly
 * like the direct API calls this seam replaced; Task 21 installs the hybrid
 * (journal-first) gateway at boot.
 */
export function setAttemptGateway(next: AttemptGateway): void {
  current = next
}

/**
 * The one gateway pages use. Forwards every call to whichever gateway is
 * installed at CALL time (not import time), so installing a new one never
 * requires touching a page.
 */
export const attemptGateway: AttemptGateway = {
  start: (slug, hint) => current.start(slug, hint),
  loadEnvelope: (attemptId) => current.loadEnvelope(attemptId),
  enterSection: (attemptId, sectionId) =>
    current.enterSection(attemptId, sectionId),
  setPosition: (attemptId, sectionId, questionId) =>
    current.setPosition(attemptId, sectionId, questionId),
  claimPlay: (attemptId, stimulusId) =>
    current.claimPlay(attemptId, stimulusId),
  finishSection: (attemptId, sectionId, body) =>
    current.finishSection(attemptId, sectionId, body),
  submit: (attemptId, body) => current.submit(attemptId, body),
  noteAnswer: (attemptId, answer) => current.noteAnswer(attemptId, answer),
  flushAnswers: (ctx) => current.flushAnswers(ctx),
  isLocalOnly: (attemptId) => current.isLocalOnly(attemptId),
  hasPendingJournal: (attemptId) => current.hasPendingJournal(attemptId),
}

export function gatewayFor(_attemptId: string): AttemptGateway {
  return attemptGateway
}
