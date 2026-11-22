import type { LocalAttemptState } from "../../src/lib/attempt/journal-types.js"
import { toPendingSection } from "../../src/lib/attempt/local-sections.js"
import { makeBundle } from "./bundle-fixture.js"

export function makeLocalState(
  over: Partial<LocalAttemptState> = {},
): LocalAttemptState {
  const bundle = makeBundle()

  return {
    attemptId: "att-1",
    slug: bundle.slug,
    testVersionId: bundle.testVersionId,
    title: bundle.title,
    attemptNumber: 1,
    ownerSub: "sub-1",
    origin: "offline",
    serverKnown: false,
    createdAt: "2026-11-22T11:00:00.000Z",
    versionDurationSeconds: bundle.durationSeconds,
    sections: bundle.sections.map(toPendingSection),
    playbackBySection: Object.fromEntries(
      bundle.sections.map((s) => [s.id, s.playback]),
    ),
    mediaKeyByStimulus: Object.fromEntries(
      bundle.media.map((m) => [m.stimulusId, m.key]),
    ),
    attemptStartedAt: null,
    attemptExpiresAt: null,
    currentSectionId: null,
    currentQuestionId: null,
    playsUsed: {},
    nextEventSeq: 1,
    syncedThrough: 0,
    finalized: null,
    syncError: null,
    ...over,
  }
}
