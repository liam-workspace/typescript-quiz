import type { OfflineBundle } from "../../src/lib/api-types.js"

/**
 * Two sections: forward-only listening (capped audio `l1.mp3`, 2 questions)
 * and free reading (1 question). Shared by the offline-store and runner tests.
 */
export function makeBundle(
  overrides: Partial<OfflineBundle> = {},
): OfflineBundle {
  return {
    slug: "practice-3",
    testVersionId: "ver-1",
    version: 1,
    title: "Practice Test 3",
    level: "primary-step-1",
    durationSeconds: 1200,
    sections: [
      {
        id: "sec-l",
        ordinal: 1,
        type: "listening",
        title: "Listening",
        questionCount: 2,
        durationSeconds: 600,
        instructions: ["Put your headphones on now."],
        navigation: "forward_only",
        allowAnswerChange: false,
        playback: { maxPlays: 1, allowPause: false, allowSeek: false },
        groups: [
          {
            id: "g-l",
            stimulus: {
              id: "st-l",
              type: "audio",
              maxPlays: 1,
              playsUsed: 0,
              allowPause: false,
              allowSeek: false,
            },
            questions: [
              {
                id: "q-l1",
                ordinal: 1,
                type: "single_choice",
                prompt: "Where is the bag?",
                choices: [
                  { id: "c-l1a", label: "Bench" },
                  { id: "c-l1b", label: "Desk" },
                ],
              },
              {
                id: "q-l2",
                ordinal: 2,
                type: "single_choice",
                prompt: "What time is it?",
                choices: [
                  { id: "c-l2a", label: "8:30" },
                  { id: "c-l2b", label: "9:00" },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "sec-r",
        ordinal: 2,
        type: "reading",
        title: "Reading",
        questionCount: 1,
        durationSeconds: 600,
        instructions: [],
        navigation: "free",
        allowAnswerChange: true,
        playback: null,
        groups: [
          {
            id: "g-r",
            stimulus: {
              id: "st-r",
              type: "passage",
              title: "Tom's garden",
              bodyText: "Tom has a small garden.",
              maxPlays: null,
            },
            questions: [
              {
                id: "q-r1",
                ordinal: 3,
                type: "single_choice",
                prompt: "What does Tom have?",
                choices: [
                  { id: "c-r1a", label: "A garden" },
                  { id: "c-r1b", label: "A boat" },
                ],
              },
            ],
          },
        ],
      },
    ],
    media: [
      {
        key: "l1.mp3",
        stimulusId: "st-l",
        kind: "audio",
        mimeType: "audio/mpeg",
        bytes: 6,
        capped: true,
        url: "/api/media/l1.mp3?exp=1&sig=aa",
      },
    ],
    totalBytes: 6,
    urlsExpireAt: "2026-11-22T12:30:00.000Z",
    ...overrides,
  }
}
