import type pg from "pg"

export interface Fixture {
  studentId: string
  testId: string
  slug: string
  versionId: string
  listeningSectionId: string
  readingSectionId: string
  questionIds: string[]
  choiceIds: string[]
  mediaAssetId: string
  cappedStimulusId: string
  uncappedStimulusId: string
}

/**
 * Seeds one test with a listening and a reading section, two questions and
 * four choices, then PUBLISHES it. Content must be written before publication:
 * the immutability trigger refuses inserts once published_at is set.
 *
 * The listening question group carries a play-capped audio stimulus (one
 * play, no pause, no seek) backed by a real media_asset row; the reading
 * question group carries an uncapped passage stimulus. Later tasks (e.g.
 * the runner projection's play-cap redaction) need at least one of each
 * kind of stimulus to exercise their filters meaningfully.
 */
export async function seedPublishedTest(pool: pg.Pool): Promise<Fixture> {
  const studentId = "11111111-1111-1111-1111-111111111111"
  const testId = "22222222-2222-2222-2222-222222222222"
  const slug = "practice-test-04"
  const versionId = "a0000000-0000-0000-0000-000000000001"
  const listeningSectionId = "b0000000-0000-0000-0000-000000000001"
  const readingSectionId = "b0000000-0000-0000-0000-000000000002"
  const groupL = "c0000000-0000-0000-0000-000000000001"
  const groupR = "c0000000-0000-0000-0000-000000000002"
  const q1 = "d0000000-0000-0000-0000-000000000001"
  const q2 = "d0000000-0000-0000-0000-000000000002"
  const c1 = "e0000000-0000-0000-0000-000000000001"
  const c2 = "e0000000-0000-0000-0000-000000000002"
  const c3 = "e0000000-0000-0000-0000-000000000003"
  const c4 = "e0000000-0000-0000-0000-000000000004"
  const mediaAssetId = "90000000-0000-0000-0000-000000000001"
  const cappedStimulusId = "70000000-0000-0000-0000-000000000001"
  const uncappedStimulusId = "70000000-0000-0000-0000-000000000002"

  await pool.query(
    `INSERT INTO student (id, subject_claim, email, display_name)
     VALUES ($1,'sub-tom','tom@example.test','Tom')`,
    [studentId],
  )
  await pool.query(`INSERT INTO test (id, slug) VALUES ($1,$2)`, [testId, slug])
  await pool.query(
    `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
     VALUES ($1,$2,1,'TOEFL Primary — Practice Test 04',3000)`,
    [versionId, testId],
  )
  await pool.query(
    `INSERT INTO test_section (id, test_version_id, ordinal, title, type, duration_seconds,
                               navigation, allow_answer_change,
                               default_max_plays, default_allow_pause, default_allow_seek)
     VALUES ($1,$3,1,'Listening — Part 1','listening',1500,'forward_only',false,1,false,false),
            ($2,$3,2,'Reading','reading',1500,'free',true,NULL,NULL,NULL)`,
    [listeningSectionId, readingSectionId, versionId],
  )
  await pool.query(
    `INSERT INTO section_instruction (test_section_id, ordinal, text)
     VALUES ($1,1,'Put your headphones on now.')`,
    [listeningSectionId],
  )

  // A real media asset and a play-capped audio stimulus on it, so later
  // tasks can prove the runner projection strips mediaUrl for a capped
  // stimulus rather than passing vacuously against an empty fixture.
  await pool.query(
    `INSERT INTO media_asset (id, kind, filename, mime_type, byte_size, checksum)
     VALUES ($1,'audio','l07.mp3','audio/mpeg',123456,'deadbeef')`,
    [mediaAssetId],
  )
  await pool.query(
    `INSERT INTO stimulus (id, test_version_id, type, media_asset_id,
                           max_plays, allow_pause, allow_seek)
     VALUES ($1,$2,'audio',$3,1,false,false)`,
    [cappedStimulusId, versionId, mediaAssetId],
  )
  await pool.query(
    `INSERT INTO stimulus (id, test_version_id, type, title, body_text)
     VALUES ($1,$2,'passage','Rainy Day','A short reading passage about a rainy day.')`,
    [uncappedStimulusId, versionId],
  )

  await pool.query(
    `INSERT INTO question_group (id, test_version_id, test_section_id, stimulus_id, ordinal)
     VALUES ($1,$3,$4,$6,1), ($2,$3,$5,$7,1)`,
    [
      groupL,
      groupR,
      versionId,
      listeningSectionId,
      readingSectionId,
      cappedStimulusId,
      uncappedStimulusId,
    ],
  )
  await pool.query(
    `INSERT INTO question (id, test_version_id, question_group_id, question_key,
                           ordinal, prompt, type, points)
     VALUES ($1,$3,$4,'q1',1,'What does the boy want to do?','single_choice',1),
            ($2,$3,$5,'q2',2,'Why did the class eat inside?','single_choice',1)`,
    [q1, q2, versionId, groupL, groupR],
  )
  await pool.query(
    `INSERT INTO choice (id, question_id, ordinal, label, is_correct)
     VALUES ($1,$5,1,'Read a book',true), ($2,$5,2,'Play football',false),
            ($3,$6,1,'It began to rain',true), ($4,$6,2,'The bus was late',false)`,
    [c1, c2, c3, c4, q1, q2],
  )
  await pool.query(
    `UPDATE test_version SET published_at = now() WHERE id = $1`,
    [versionId],
  )
  await pool.query(`UPDATE test SET current_version_id = $1 WHERE id = $2`, [
    versionId,
    testId,
  ])

  return {
    studentId,
    testId,
    slug,
    versionId,
    listeningSectionId,
    readingSectionId,
    questionIds: [q1, q2],
    choiceIds: [c1, c2, c3, c4],
    mediaAssetId,
    cappedStimulusId,
    uncappedStimulusId,
  }
}

export interface MixedFixture {
  studentId: string
  versionId: string
  questionId: string
  choiceId: string
}

/**
 * A second, self-contained published test whose only question hangs off a
 * `mixed` stimulus — text AND media together.
 *
 * Separate from `seedPublishedTest` rather than folded into it because
 * several suites assert exact question counts against that fixture, and
 * because content must be written BEFORE publication (the immutability
 * trigger refuses inserts once `published_at` is set), so a mixed stimulus
 * cannot be appended to an already-published version.
 *
 * `media_asset.kind` is deliberately `image` here: `mixed` names only
 * "text plus media" and never says which, so an image-backed mixed stimulus
 * is exactly the case a projection that assumes audio gets wrong.
 */
export async function seedMixedStimulusTest(
  pool: pg.Pool,
): Promise<MixedFixture> {
  const studentId = "11111111-1111-1111-1111-111111111112"
  const testId = "22222222-2222-2222-2222-222222222223"
  const versionId = "a0000000-0000-0000-0000-000000000002"
  const sectionId = "b0000000-0000-0000-0000-000000000003"
  const groupId = "c0000000-0000-0000-0000-000000000003"
  const questionId = "d0000000-0000-0000-0000-000000000003"
  const choiceId = "e0000000-0000-0000-0000-000000000005"
  const mediaAssetId = "90000000-0000-0000-0000-000000000002"
  const stimulusId = "70000000-0000-0000-0000-000000000003"

  await pool.query(
    `INSERT INTO student (id, subject_claim, email, display_name)
     VALUES ($1,'sub-mixed','mixed@example.test','Mixed')`,
    [studentId],
  )
  await pool.query(`INSERT INTO test (id, slug) VALUES ($1,'mixed-test')`, [
    testId,
  ])
  await pool.query(
    `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
     VALUES ($1,$2,1,'Mixed stimulus practice',600)`,
    [versionId, testId],
  )
  await pool.query(
    `INSERT INTO test_section (id, test_version_id, ordinal, title, type, duration_seconds,
                               navigation, allow_answer_change)
     VALUES ($1,$2,1,'Listening — Mixed','listening',600,'free',true)`,
    [sectionId, versionId],
  )
  await pool.query(
    `INSERT INTO media_asset (id, kind, filename, mime_type, byte_size, checksum)
     VALUES ($1,'image','m01.png','image/png',2048,'cafebabe')`,
    [mediaAssetId],
  )
  await pool.query(
    `INSERT INTO stimulus (id, test_version_id, type, title, body_text, media_asset_id)
     VALUES ($1,$2,'mixed','At the park','Look and listen.',$3)`,
    [stimulusId, versionId, mediaAssetId],
  )
  await pool.query(
    `INSERT INTO question_group (id, test_version_id, test_section_id, stimulus_id, ordinal)
     VALUES ($1,$2,$3,$4,1)`,
    [groupId, versionId, sectionId, stimulusId],
  )
  await pool.query(
    `INSERT INTO question (id, test_version_id, question_group_id, question_key,
                           ordinal, prompt, type, points)
     VALUES ($1,$2,$3,'qm1',1,'What is happening?','single_choice',1)`,
    [questionId, versionId, groupId],
  )
  await pool.query(
    `INSERT INTO choice (id, question_id, ordinal, label, is_correct)
     VALUES ($1,$2,1,'A game',true)`,
    [choiceId, questionId],
  )
  await pool.query(
    `UPDATE test_version SET published_at = now() WHERE id = $1`,
    [versionId],
  )
  await pool.query(`UPDATE test SET current_version_id = $1 WHERE id = $2`, [
    versionId,
    testId,
  ])

  return { studentId, versionId, questionId, choiceId }
}
