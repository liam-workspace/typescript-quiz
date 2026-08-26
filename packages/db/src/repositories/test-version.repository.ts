import {
  asChoiceId,
  asGroupId,
  asQuestionId,
  asSectionId,
  asStimulusId,
  type RunnerGroup,
  type RunnerQuestion,
  type RunnerSection,
  type RunnerStimulus,
  type ScoringQuestion,
} from "@pp/common"
import type pg from "pg"

interface RunnerRow {
  s_id: string
  s_type: string
  s_ordinal: number
  s_navigation: string
  s_allow_change: boolean
  s_max_plays: number | null
  s_allow_pause: boolean | null
  s_allow_seek: boolean | null
  g_id: string
  g_ordinal: number
  st_id: string | null
  st_type: string | null
  st_title: string | null
  st_body: string | null
  st_filename: string | null
  st_max_plays: number | null
  st_allow_pause: boolean | null
  st_allow_seek: boolean | null
  plays_used: number | null
  q_id: string
  q_ordinal: number
  q_type: string
  q_prompt: string
  c_id: string
  c_ordinal: number
  c_label: string
}

interface ScoringRow {
  q_id: string
  q_ordinal: number
  q_type: string
  q_prompt: string
  q_points: number
  c_id: string
  c_label: string
  c_correct: boolean
}

/**
 * The STUDENT projection. Two things are absent by construction rather than by
 * filtering: choice.is_correct is never selected, and mediaUrl is emitted only
 * when the stimulus's effective max_plays is null. A capped stimulus's URL is
 * issued by POST /play, which increments a play counter this query only reads.
 *
 * `attemptId` supplies exactly one thing: playsUsed, read from stimulus_play.
 * Pass null to load a version with no attempt (a preview), and playsUsed is 0
 * throughout. Nothing else in the returned tree depends on it -- per-attempt
 * section progress lives in attempt_section, which this query does not join
 * and RunnerSection does not claim to carry.
 */
export async function loadForRunner(
  pool: pg.Pool,
  versionId: string,
  attemptId: string | null,
): Promise<RunnerSection[]> {
  const { rows } = await pool.query<RunnerRow>(
    `SELECT ts.id s_id, ts.type::text s_type, ts.ordinal s_ordinal,
            ts.navigation::text s_navigation, ts.allow_answer_change s_allow_change,
            ts.default_max_plays s_max_plays, ts.default_allow_pause s_allow_pause,
            ts.default_allow_seek s_allow_seek,
            g.id g_id, g.ordinal g_ordinal,
            st.id st_id, st.type::text st_type, st.title st_title, st.body_text st_body,
            ma.filename st_filename, st.max_plays st_max_plays,
            st.allow_pause st_allow_pause, st.allow_seek st_allow_seek,
            sp.play_count plays_used,
            q.id q_id, q.ordinal q_ordinal, q.type::text q_type, q.prompt q_prompt,
            c.id c_id, c.ordinal c_ordinal, c.label c_label
       FROM test_section ts
       JOIN question_group g ON g.test_section_id = ts.id
       JOIN question q       ON q.question_group_id = g.id
       JOIN choice c         ON c.question_id = q.id
  LEFT JOIN stimulus st      ON st.id = g.stimulus_id
  LEFT JOIN media_asset ma   ON ma.id = st.media_asset_id
  LEFT JOIN stimulus_play sp ON sp.stimulus_id = st.id AND sp.attempt_id = $2
      WHERE ts.test_version_id = $1
      ORDER BY ts.ordinal, g.ordinal, q.ordinal, c.ordinal`,
    [versionId, attemptId],
  )

  const sections: RunnerSection[] = []
  for (const r of rows) {
    const section = findOrCreateSection(sections, r)
    const group = findOrCreateGroup(section, r)
    const question = findOrCreateQuestion(group, r)

    question.choices.push({ id: asChoiceId(r.c_id), label: r.c_label })
  }

  return sections
}

function findOrCreateSection(
  sections: RunnerSection[],
  r: RunnerRow,
): RunnerSection {
  const existing = sections.find((s) => s.id === asSectionId(r.s_id))

  if (existing) {
    return existing
  }

  const section: RunnerSection = {
    id: asSectionId(r.s_id),
    type: r.s_type as RunnerSection["type"],
    navigation: r.s_navigation as RunnerSection["navigation"],
    allowAnswerChange: r.s_allow_change,
    groups: [],
  }

  sections.push(section)

  return section
}

function findOrCreateGroup(section: RunnerSection, r: RunnerRow): RunnerGroup {
  const existing = section.groups.find((g) => g.id === asGroupId(r.g_id))

  if (existing) {
    return existing
  }

  const group: RunnerGroup = {
    id: asGroupId(r.g_id),
    ...(r.st_id ? { stimulus: buildStimulus(r, r.st_id) } : {}),
    questions: [],
  }

  section.groups.push(group)

  return group
}

/**
 * `stimulusId` is passed separately (rather than re-read from `r.st_id`) so
 * the caller's null check narrows it to a plain string once, here.
 */
function buildStimulus(r: RunnerRow, stimulusId: string): RunnerStimulus {
  const maxPlays = r.st_max_plays ?? r.s_max_plays ?? null

  return {
    id: asStimulusId(stimulusId),
    type: r.st_type as RunnerStimulus["type"],
    ...(r.st_title ? { title: r.st_title } : {}),
    ...(r.st_body ? { bodyText: r.st_body } : {}),
    maxPlays,
    playsUsed: r.plays_used ?? 0,
    allowPause: r.st_allow_pause ?? r.s_allow_pause ?? true,
    allowSeek: r.st_allow_seek ?? r.s_allow_seek ?? true,
    // A capped stimulus gets no url here: the url is issued only by
    // POST /play, which counts plays. Uncapped media is safe to hand over
    // directly because there is no cap left to defeat.
    ...(maxPlays === null && r.st_filename
      ? { mediaUrl: `/media/${r.st_filename}` }
      : {}),
  }
}

function findOrCreateQuestion(
  group: RunnerGroup,
  r: RunnerRow,
): RunnerQuestion {
  const existing = group.questions.find((q) => q.id === asQuestionId(r.q_id))

  if (existing) {
    return existing
  }

  const question: RunnerQuestion = {
    id: asQuestionId(r.q_id),
    ordinal: r.q_ordinal,
    type: r.q_type as RunnerQuestion["type"],
    prompt: r.q_prompt,
    choices: [],
  }

  group.questions.push(question)

  return question
}

/**
 * The SCORING projection — the answer key. Reachable only from the scoring
 * service; no student-facing route may import it.
 */
export async function loadForScoring(
  pool: pg.Pool,
  versionId: string,
): Promise<ScoringQuestion[]> {
  const { rows } = await pool.query<ScoringRow>(
    `SELECT q.id q_id, q.ordinal q_ordinal, q.type::text q_type, q.prompt q_prompt,
            q.points q_points, c.id c_id, c.label c_label, c.is_correct c_correct
       FROM question q JOIN choice c ON c.question_id = q.id
      WHERE q.test_version_id = $1
      ORDER BY q.ordinal, c.ordinal`,
    [versionId],
  )

  const questions: ScoringQuestion[] = []
  for (const r of rows) {
    const question = findOrCreateScoringQuestion(questions, r)

    question.choices.push({
      id: asChoiceId(r.c_id),
      label: r.c_label,
      isCorrect: r.c_correct,
    })
  }

  return questions
}

function findOrCreateScoringQuestion(
  questions: ScoringQuestion[],
  r: ScoringRow,
): ScoringQuestion {
  const existing = questions.find((q) => q.id === asQuestionId(r.q_id))

  if (existing) {
    return existing
  }

  const question: ScoringQuestion = {
    id: asQuestionId(r.q_id),
    ordinal: r.q_ordinal,
    type: r.q_type as ScoringQuestion["type"],
    prompt: r.q_prompt,
    points: r.q_points,
    choices: [],
  }

  questions.push(question)

  return question
}
