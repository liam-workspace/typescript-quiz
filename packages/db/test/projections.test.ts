import type {
  RunnerGroup,
  RunnerQuestion,
  RunnerSection,
  RunnerStimulus,
} from "@pp/common"
import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"
import { seedMixedStimulusTest, seedPublishedTest } from "./helpers/fixtures.js"
import {
  loadForRunner,
  loadForScoring,
} from "../src/repositories/test-version.repository.js"

// Hoisted so chained array-method callbacks below do not add a fourth
// level of nested callback (oxlint max-nested-callbacks: 3).
function groupsOf(section: RunnerSection): RunnerGroup[] {
  return section.groups
}

function questionsOf(group: RunnerGroup): RunnerQuestion[] {
  return group.questions
}

function stimulusOf(group: RunnerGroup): RunnerStimulus | undefined {
  return group.stimulus
}

function ordinalOf(question: RunnerQuestion): number {
  return question.ordinal
}

function typeOf(section: RunnerSection): RunnerSection["type"] {
  return section.type
}

function byAscending(a: number, b: number): number {
  return a - b
}

function isCorrectChoice(choice: { isCorrect: boolean }): boolean {
  return choice.isCorrect
}

function isCappedStimulus(
  stimulus: RunnerStimulus | undefined,
): stimulus is RunnerStimulus {
  return stimulus !== undefined && stimulus.maxPlays !== null
}

function idEquals(id: unknown) {
  return (item: { id: unknown }): boolean => item.id === id
}

function stimulusIdEquals(id: unknown) {
  return (stimulus: { id: unknown } | undefined): boolean => stimulus?.id === id
}

describe("projections", () => {
  it("loadForRunner never returns isCorrect anywhere in the tree", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const sections = await loadForRunner(pool, f.versionId, null)

      expect(JSON.stringify(sections)).not.toContain("isCorrect")
      expect(JSON.stringify(sections)).not.toContain("is_correct")
    })
  }, 120_000)

  it("loadForRunner choices carry only id and label, never isCorrect", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const sections = await loadForRunner(pool, f.versionId, null)
      const question = sections
        .flatMap(groupsOf)
        .flatMap(questionsOf)
        .find(idEquals(f.questionIds[0]))

      if (!question) {
        throw new Error("expected the fixture's first question to be present")
      }

      for (const choice of question.choices) {
        expect(Object.keys(choice)).toEqual(["id", "label"])
      }
    })
  }, 120_000)

  it("loadForRunner omits mediaUrl for a capped stimulus", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const sections = await loadForRunner(pool, f.versionId, null)
      const capped = sections
        .flatMap(groupsOf)
        .map(stimulusOf)
        .filter(isCappedStimulus)

      for (const s of capped) {
        expect(s.mediaUrl).toBeUndefined()
      }
    })
  }, 120_000)

  // The above filter passes vacuously if the fixture seeds no capped
  // stimulus. This test names the fixture's capped stimulus directly so a
  // projection that omitted mediaUrl from EVERYTHING (a different bug, not
  // the fix) is still exercised on a known-audio, known-capped row.
  it("loadForRunner omits mediaUrl for the fixture's named capped stimulus", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const sections = await loadForRunner(pool, f.versionId, null)
      const stimuli = sections.flatMap(groupsOf).map(stimulusOf)
      const capped = stimuli.find(stimulusIdEquals(f.cappedStimulusId))

      if (!capped) {
        throw new Error("expected the fixture's capped stimulus to be present")
      }

      // An absent key and a key holding `undefined` are different; only the
      // `in` check catches a projection that spreads `mediaUrl: undefined`
      // instead of omitting the key entirely.
      expect("mediaUrl" in capped).toBe(false)
    })
  }, 120_000)

  // The fixture's uncappedStimulusId is a PASSAGE (body_text only): the
  // stimulus_passage_has_text CHECK constraint forbids a passage from ever
  // carrying media_asset_id, so it can never carry a mediaUrl regardless of
  // cap status or projection correctness — it cannot be the positive case
  // that distinguishes a correct projection from one that omits mediaUrl
  // unconditionally. This seeds a second, UNPUBLISHED version (so the
  // publication-immutability triggers do not block the insert) with an
  // uncapped AUDIO stimulus reusing the fixture's media asset, giving an
  // actually media-backed, actually uncapped row to assert on.
  it("loadForRunner keeps mediaUrl for an uncapped stimulus that carries media", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)

      const { rows: testRows } = await pool.query<{ id: string }>(
        `INSERT INTO test (slug) VALUES ('positive-media-check') RETURNING id`,
      )
      const testId = testRows[0].id
      const { rows: versionRows } = await pool.query<{ id: string }>(
        `INSERT INTO test_version (test_id, version, title, duration_seconds)
         VALUES ($1, 1, 'Positive media check', 600) RETURNING id`,
        [testId],
      )
      const draftVersionId = versionRows[0].id
      const { rows: sectionRows } = await pool.query<{ id: string }>(
        `INSERT INTO test_section (test_version_id, ordinal, title, type, duration_seconds,
                                    navigation, allow_answer_change,
                                    default_max_plays, default_allow_pause, default_allow_seek)
         VALUES ($1, 1, 'Listening', 'listening', 300, 'free', true, NULL, NULL, NULL)
         RETURNING id`,
        [draftVersionId],
      )
      const sectionId = sectionRows[0].id
      const { rows: stimulusRows } = await pool.query<{ id: string }>(
        `INSERT INTO stimulus (test_version_id, type, media_asset_id, max_plays, allow_pause, allow_seek)
         VALUES ($1, 'audio', $2, NULL, false, false) RETURNING id`,
        [draftVersionId, f.mediaAssetId],
      )
      const stimulusId = stimulusRows[0].id
      const { rows: groupRows } = await pool.query<{ id: string }>(
        `INSERT INTO question_group (test_version_id, test_section_id, stimulus_id, ordinal)
         VALUES ($1, $2, $3, 1) RETURNING id`,
        [draftVersionId, sectionId, stimulusId],
      )
      const groupId = groupRows[0].id
      const { rows: questionRows } = await pool.query<{ id: string }>(
        `INSERT INTO question (test_version_id, question_group_id, question_key, ordinal, prompt, type, points)
         VALUES ($1, $2, 'pq1', 1, 'Prompt', 'single_choice', 1) RETURNING id`,
        [draftVersionId, groupId],
      )
      const questionId = questionRows[0].id

      await pool.query(
        `INSERT INTO choice (question_id, ordinal, label, is_correct) VALUES ($1, 1, 'A', true)`,
        [questionId],
      )

      const sections = await loadForRunner(pool, draftVersionId, null)
      const stimulus = sections
        .flatMap(groupsOf)
        .find(idEquals(groupId))?.stimulus

      expect(stimulus).toBeDefined()
      expect(stimulus?.mediaUrl).toBe("/media/l07.mp3")
    })
  }, 120_000)

  it("loadForRunner carries imageSvg for a picture choice, and omits it otherwise", async () => {
    await withDatabase(async (pool) => {
      const { rows: testRows } = await pool.query<{ id: string }>(
        `INSERT INTO test (slug) VALUES ('picture-choice-check') RETURNING id`,
      )
      const testId = testRows[0].id
      const { rows: versionRows } = await pool.query<{ id: string }>(
        `INSERT INTO test_version (test_id, version, title, duration_seconds)
         VALUES ($1, 1, 'Picture choice check', 600) RETURNING id`,
        [testId],
      )
      const draftVersionId = versionRows[0].id
      const { rows: sectionRows } = await pool.query<{ id: string }>(
        `INSERT INTO test_section (test_version_id, ordinal, title, type, duration_seconds,
                                    navigation, allow_answer_change,
                                    default_max_plays, default_allow_pause, default_allow_seek)
         VALUES ($1, 1, 'Listening', 'listening', 300, 'free', true, NULL, NULL, NULL)
         RETURNING id`,
        [draftVersionId],
      )
      const sectionId = sectionRows[0].id
      const { rows: groupRows } = await pool.query<{ id: string }>(
        `INSERT INTO question_group (test_version_id, test_section_id, ordinal)
         VALUES ($1, $2, 1) RETURNING id`,
        [draftVersionId, sectionId],
      )
      const groupId = groupRows[0].id
      const { rows: questionRows } = await pool.query<{ id: string }>(
        `INSERT INTO question (test_version_id, question_group_id, question_key, ordinal, prompt, type, points)
         VALUES ($1, $2, 'pq1', 1, 'Which picture?', 'single_choice', 1) RETURNING id`,
        [draftVersionId, groupId],
      )
      const questionId = questionRows[0].id
      const svg = '<svg viewBox="0 0 10 10"><circle r="4"/></svg>'

      await pool.query(
        `INSERT INTO choice (question_id, ordinal, label, is_correct, image_svg)
         VALUES ($1, 1, 'A', true, $2)`,
        [questionId, svg],
      )
      await pool.query(
        `INSERT INTO choice (question_id, ordinal, label, is_correct) VALUES ($1, 2, 'B', false)`,
        [questionId],
      )

      const sections = await loadForRunner(pool, draftVersionId, null)
      const [choiceA, choiceB] =
        sections
          .flatMap(groupsOf)
          .flatMap(questionsOf)
          .find(idEquals(questionId))?.choices ?? []

      expect(choiceA.imageSvg).toBe(svg)
      expect("imageSvg" in choiceB).toBe(false)
    })
  }, 120_000)

  it("loadForRunner returns sections and questions in ordinal order", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const sections = await loadForRunner(pool, f.versionId, null)

      expect(sections.map(typeOf)).toEqual(["listening", "reading"])

      const ordinals = sections
        .flatMap(groupsOf)
        .flatMap(questionsOf)
        .map(ordinalOf)

      expect(ordinals).toEqual([...ordinals].sort(byAscending))
    })
  }, 120_000)

  // Per-attempt progress lives in attempt_section, which this query does not
  // join. The projection used to emit status/completedAt/expiresAt as
  // constants regardless of attemptId; this pins the key set so they cannot
  // come back as lies rather than as a join.
  it("loadForRunner sections carry no per-attempt progress fields", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const sections = await loadForRunner(pool, f.versionId, null)

      expect(sections.length).toBeGreaterThan(0)

      for (const section of sections) {
        expect(Object.keys(section).sort()).toEqual([
          "allowAnswerChange",
          "groups",
          "id",
          "navigation",
          "type",
        ])
      }
    })
  }, 120_000)

  // `mixed` names only "text plus media", never WHICH media -- unlike the
  // audio/image branches, whose type IS the discriminator. This fixture is
  // deliberately image-backed (see seedMixedStimulusTest's own doc comment):
  // exactly the case a projection that assumes audio gets wrong.
  it("loadForRunner projects mediaKind for a mixed stimulus", async () => {
    await withDatabase(async (pool) => {
      const f = await seedMixedStimulusTest(pool)
      const sections = await loadForRunner(pool, f.versionId, null)
      const stimulus = sections.flatMap(groupsOf).map(stimulusOf).find(Boolean)

      expect(stimulus).toBeDefined()
      expect(stimulus?.type).toBe("mixed")
      expect(stimulus?.mediaKind).toBe("image")
    })
  }, 120_000)

  // The fixture's mixed stimulus has no max_plays set anywhere (neither on
  // the stimulus nor the section default), so it is uncapped -- mediaUrl
  // should still appear, exactly like an uncapped image or audio stimulus.
  it("loadForRunner keeps mediaUrl for an uncapped mixed stimulus", async () => {
    await withDatabase(async (pool) => {
      const f = await seedMixedStimulusTest(pool)
      const sections = await loadForRunner(pool, f.versionId, null)
      const stimulus = sections.flatMap(groupsOf).map(stimulusOf).find(Boolean)

      expect(stimulus?.maxPlays).toBeNull()
      expect(stimulus?.mediaUrl).toBe("/media/m01.png")
    })
  }, 120_000)

  // No key other than "mixed" ever carries mediaKind -- it would be a
  // silently-wrong signal on a type whose own `type` already IS the media
  // discriminator (audio, image, passage).
  it("loadForRunner omits mediaKind for a non-mixed stimulus", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const sections = await loadForRunner(pool, f.versionId, null)
      const stimuli = sections.flatMap(groupsOf).map(stimulusOf)

      expect(stimuli.length).toBeGreaterThan(0)

      for (const s of stimuli) {
        expect(s && "mediaKind" in s).toBe(false)
      }
    })
  }, 120_000)

  it("loadForScoring returns the answer key", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const questions = await loadForScoring(pool, f.versionId)

      expect(questions).toHaveLength(2)
      expect(questions[0].choices.filter(isCorrectChoice)).toHaveLength(1)
      expect(questions[0].points).toBe(1)
    })
  }, 120_000)
})
