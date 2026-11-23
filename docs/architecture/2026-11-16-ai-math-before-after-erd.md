# AI Mathematics Rollout — Before and After ERD

## Before

Today, imported authored content belongs to a draft `test_version`, then is
frozen when published. A question and choice store only flat text. The
diagram includes the content graph that matters for question authoring; it
omits attempts, responses, and media-asset internals.

```mermaid
erDiagram
  TEST ||--o{ TEST_VERSION : has
  TEST_VERSION ||--o{ TEST_SECTION : contains
  TEST_SECTION ||--o{ SECTION_INSTRUCTION : has
  TEST_VERSION ||--o{ STIMULUS : owns
  TEST_SECTION ||--o{ QUESTION_GROUP : contains
  STIMULUS o|--o{ QUESTION_GROUP : supplies
  QUESTION_GROUP ||--o{ QUESTION : contains
  QUESTION ||--o{ CHOICE : offers
  QUESTION ||--o{ QUESTION_TAG : has

  TEST {
    uuid id PK
    text slug UK
    uuid current_version_id FK
  }
  TEST_VERSION {
    uuid id PK
    uuid test_id FK
    int version
    text title
    timestamptz published_at
  }
  TEST_SECTION {
    uuid id PK
    uuid test_version_id FK
    int ordinal
    section_type section_kind
  }
  SECTION_INSTRUCTION {
    uuid test_section_id PK
    int ordinal PK
    text instruction_body
  }
  STIMULUS {
    uuid id PK
    uuid test_version_id FK
    stimulus_type stimulus_kind
    text body_text
  }
  QUESTION_GROUP {
    uuid id PK
    uuid test_version_id FK
    uuid test_section_id FK
    int ordinal
  }
  QUESTION {
    uuid id PK
    uuid test_version_id FK
    uuid question_group_id FK
    text question_key
    int ordinal
    text prompt
    question_type question_kind
    int points
  }
  CHOICE {
    uuid id PK
    uuid question_id FK
    int ordinal
    text label
    boolean is_correct
  }
  QUESTION_TAG {
    uuid question_id FK
    int ordinal
    text tag
  }
```

## After

The publication graph stays intact. AI workflow data is isolated in generation
tables until an admin approves a validated candidate. Published math metadata
is attached to a normal immutable question.

```mermaid
erDiagram
  TEST ||--o{ TEST_VERSION : has
  TEST_VERSION ||--o{ TEST_SECTION : contains
  TEST_SECTION ||--o{ SECTION_INSTRUCTION : has
  TEST_VERSION ||--o{ STIMULUS : owns
  TEST_SECTION ||--o{ QUESTION_GROUP : contains
  STIMULUS o|--o{ QUESTION_GROUP : supplies
  QUESTION_GROUP ||--o{ QUESTION : contains
  QUESTION ||--o{ CHOICE : offers
  QUESTION ||--o{ QUESTION_TAG : has
  QUESTION ||--o| QUESTION_MATH : "has canonical math"
  MATH_PROBLEM_TEMPLATE ||--o{ AI_GENERATION_REQUEST : drives
  AI_GENERATION_REQUEST ||--o{ AI_GENERATION_CANDIDATE : produces
  AI_GENERATION_CANDIDATE o|--o| QUESTION_MATH : "source of"
  AI_GENERATION_CANDIDATE o|--o| TEST_VERSION : "imported into"

  QUESTION {
    uuid id PK
    uuid test_version_id FK
    jsonb prompt_blocks
    text prompt
  }
  CHOICE {
    uuid id PK
    uuid question_id FK
    jsonb label_blocks
    text label
    boolean is_correct
  }
  QUESTION_TAG {
    uuid question_id PK
    int ordinal PK
    text tag
  }
  QUESTION_MATH {
    uuid question_id PK
    uuid source_candidate_id UK
    jsonb canonical_spec
    jsonb answer_spec
    jsonb solution_blocks
    text verifier_version
    text latex_renderer_version
    text content_hash UK
  }
  MATH_PROBLEM_TEMPLATE {
    uuid id PK
    text code UK
    text family
    int schema_version
    jsonb input_schema
    jsonb generator_config
    boolean active
  }
  AI_GENERATION_REQUEST {
    uuid id PK
    uuid template_id FK
    jsonb curriculum_brief
    text provider
    text model
    text prompt_version
    text requested_by
    timestamptz created_at
  }
  AI_GENERATION_CANDIDATE {
    uuid id PK
    uuid request_id FK
    int ordinal
    jsonb canonical_spec
    jsonb model_response
    jsonb validation_report
    text status
    text reviewer_subject
    timestamptz reviewed_at
    uuid imported_test_version_id FK
  }
```

## Relationship rules

- `AI_GENERATION_CANDIDATE.status` is one of `pending`, `valid`, `rejected`,
  `approved`, or `imported`; only `approved` may be transformed into an import
  document.
- `QUESTION_MATH.question_id` is one-to-one and only exists for a question
  whose content uses math blocks. `source_candidate_id` is optional for
  manually authored math, otherwise unique and points to the approved source
  candidate.
- `QUESTION_MATH.content_hash` is unique across approved content to block
  exact canonical duplicates.
- `imported_test_version_id` is set only after the existing import succeeds.
- Published `QUESTION`, `CHOICE`, and `QUESTION_MATH` data is frozen by the
  same version-publishing rule that protects authored questions today. The
  new `QUESTION_MATH` table needs its own immutability trigger that resolves
  its parent question's `test_version_id`; existing triggers do not reach new
  child tables automatically.
- `prompt` and `label` remain the existing required compatibility fields while
  nullable `prompt_blocks` and `label_blocks` are introduced. Blocks become
  authoritative only after the importer, exporter, runner DTOs, and every
  active authoring path support them; removing the flat fields is a later
  breaking migration.
