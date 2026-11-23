# AI Mathematics Rollout — Before and After Features

## Before

| Area | Current feature | Limitation for math authoring |
| --- | --- | --- |
| Content authoring | Admin imports a complete JSON `TestDocument` | No candidate/draft queue, provenance, or review state |
| Section model | Listening, reading, vocabulary, and grammar only | No truthful `math` section can enter the existing import/publish path |
| Question content | Flat `prompt` and `choice.label` text | No typed distinction between prose and TeX |
| Correctness | Import validates number of choices and correct-choice count | Cannot prove an equation or fraction answer is mathematically true |
| Publishing | Admin publishes an immutable test version | Safe publication boundary already exists |
| Student runner | Renders text, images, audio, and SVG | No accessible math renderer |
| Audit | Imported test version history | No model, prompt, seed, validation, or reviewer provenance |

## After

| Capability | Admin experience | System behaviour | Student experience |
| --- | --- | --- | --- |
| Curriculum batch | Select level, family, bounds, count, and language | Saves a structured `curriculum_brief` and request | None until publication |
| Deterministic problem | Pick template and seed | Produces canonical AST, answer spec, and base distractors | None until publication |
| AI enrichment | Request variants/explanations | Accepts only schema-constrained JSON; no learner data is sent | None until publication |
| Automatic validation | See explicit pass/fail reasons | Checks schema, math, choice equivalence, LaTeX, safety, dedupe, and import shape | None until approved |
| Review queue | Preview, approve, reject, regenerate | Records reviewer and decisions; only approved candidates can import | None until publication |
| Standard import/publish | Use the existing draft/import/publish flow | Retains immutable-version and publication invariants | New math questions appear only in published versions |
| Math section | Create an explicit `math` section | Extends enum, interchange schema, publish validation, runner DTOs, and UI | Math is identified correctly rather than masquerading as another subject |
| Math rendering | Preview exactly what a learner sees | Renders typed TeX blocks with KaTeX in strict, untrusted mode | Accessible inline/display mathematics with MathML output |
| Post-test explanation | Configure by content policy | Stores approved solution blocks separately from answer truth | Optional explanation at the permitted review point |
| Audit/reporting | Inspect batch/candidate history | Shows provider/model, prompt version, seed, validation report, reviewer, linked test version | No exposure of internal generation metadata |

## Phased feature release

### Release 0 — math contract, renderer, and content blocks

- Add an explicit `math` section type through the DB enum, import/export
  schema, publish checks, runner DTOs, and UI.
- Admin preview of text and math blocks.
- KaTeX parse/safety checks in the import and preview paths.
- No AI button and no new student questions.

**Exit criteria:** known-good and malformed TeX fixtures render/reject
predictably; old text-only imports remain byte-for-byte compatible; math
sections survive import/export and reach a runner preview without reusing an
existing subject type.

### Release 1 — deterministic math candidates

- Admin creates fraction and percentage candidate batches from templates.
- Validator and review queue work without an AI provider.
- Approved candidates produce a normal import payload.

**Exit criteria:** every approved candidate has a reproducible seed and a
passing verifier; reviewer can reject without affecting any test draft.

### Release 2 — AI-assisted enrichment

- AI supplies constrained wording and worked explanations for a canonical
  problem.
- Admin reviews every candidate.
- Feature flag, cost/rate limits, batch maximum of 20, and audit metrics.

**Exit criteria:** validation and reviewer edits are measured by family/model;
no candidate bypasses review or import validation.

### Release 3 — additional families

- One-variable linear equations after an explicit equation verifier exists.
- Word-problem units after controlled vocabulary/rubric support exists.
- Geometry/diagrams only after separate SVG/image-safe generation and visual
  QA are designed.

**Exit criteria:** each family has deterministic fixtures, a verifier,
documented difficulty ranges, and reviewer guidance.

## Explicitly deferred

- Automatic publishing.
- Free-response symbolic answer marking.
- Student-specific AI adaptation.
- AI-generated diagrams or arbitrary SVG.
- Regenerating content inside an already published version.
