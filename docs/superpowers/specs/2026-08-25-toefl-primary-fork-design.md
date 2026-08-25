# TOEFL Primary practice-test fork — design

**Date:** 2026-08-25
**Status:** approved, ready for implementation planning
**Branch:** `develop`

Forks Razzia — a live, host-driven quiz platform — into an asynchronous
TOEFL Primary practice-test runner for a family. The change is not a feature
addition; it replaces the execution model.

```
Razzia today   Host → Lobby → Players → Live question → Leaderboard
This fork      Library → Student → Attempt → Sections → Submit → Result → History
```

## Companion documents

This spec is the narrative. The precise contracts live beside it and are
machine-checked; where they disagree with this document, they win.

| Document                                | Status                                                            |
| --------------------------------------- | ----------------------------------------------------------------- |
| `docs/prototype/index.html`             | 12 clickable screens, API annotated per screen                    |
| `docs/api/openapi.yaml`                 | 20 operations — `redocly lint` clean                              |
| `docs/api/catalog.html`                 | resource-grouped view of the same catalog                         |
| `docs/db/schema.sql`                    | the database design — executed against PostgreSQL 16              |
| `docs/db/invariants.test.sql`           | proves each constraint rejects what it claims                     |
| `docs/diagrams/er.*`                    | 17-entity relational model, generated from the schema             |
| `docs/architecture/library-adoption.md` | a verdict on all 47 packages in `~/projects/typescript-libraries` |

## 1. Scope

### In — v1 is the student spine

A student signs in with Google, picks a published test, sits it under exam
conditions, hands it in, sees a score, and reviews their answers. Tests reach
the database by JSON import; there is no authoring UI.

1. Google sign-in via `auth.icovn.me`; a student profile IS the account.
   After first sign-in the device enrols a **passkey**, so a returning student
   authenticates with Face ID rather than a full OIDC tab redirect — which also
   removes the redirect from the middle of a running attempt
2. Test library with per-test standing and re-attempt
3. Test brief and per-section rules screens
4. Listening: audio plays once, no pause or seek, forward-only navigation
5. Reading: free navigation, answers changeable until hand-in
6. Whole-test and per-section timers, server-authoritative
7. Answer autosave that cannot lose an answer (§5)
8. Resume after reload, crash or network loss
9. Auto-submit on expiry
10. Automatic grading and a result screen
11. Review answers, including unanswered ones
12. Attempt history with per-section breakdown
13. Collapsible question navigator and app menu
14. JSON import / export, publish, media upload
15. Docker deployment

### Out — deliberately deferred

The authoring editor (its own spec), classroom or teacher roles, email,
certificates, official TOEFL scaled-score conversion, analytics beyond
per-section history, live multiplayer, SCORM, LTI, Redis, cloud object storage.

## 2. Architecture

```
                    Browser
              React 19 + Vite (packages/app)
                        │  Bearer JWT
                        ▼
              packages/server  ── JWKS verify ──▶ auth.icovn.me
                        │
          ┌─────────────┴─────────────┐
          ▼                           ▼
   packages/db                  /media volume
   PostgreSQL 16                mp3 · images
```

### Packages

```
packages/
├── common/   domain types + Zod validators for the JSON interchange format
├── db/       migrations + repositories  (@liam-public/shared-core)
├── server/   NestJS REST API + JWKS verification and passkey ceremony
└── app/      Vite + React 19 SPA
```

`packages/app` takes its **components from `@liam-public/browser-react-ui`**,
not from Razzia. Both are Tailwind v4 + Radix, so the kit is the same stack
already tested and maintained elsewhere — and its `sheet` primitive is exactly
the collapsible drawer the prototype draws by hand. Copying Razzia's
`components/*` would fork a component library to avoid depending on one.

What is still worth harvesting from `packages/web` is the parts the kit does
not cover: `vite.config.ts`, the tsconfigs, the TanStack router plugin,
`i18n.ts` with all seven locale trees, `QuestionMedia.tsx` and `branding.ts`.
Left behind: `features/game/**`, the Zustand game stores, the socket context,
`PinInput`, `qrcode.react`, `react-confetti`, `use-sound`.

`packages/socket` and `packages/web` are deleted in plan 3, once `app` can
replace them — not in phase 0, so the repository never spends two plans with
no runnable application.

### Libraries already solving this

All 47 packages in `~/projects/typescript-libraries` were surveyed;
**28 are adopted**, 3 wait for the admin spec, 6 are declined with reasons, and
12 share no subject matter. The verdicts are in
`docs/architecture/library-adoption.md` — consult it before adding any
dependency.

| Concern                                                             | Package                                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Pooling, transactions, migrations, logging, HTTP, crypto, event bus | `@liam-public/shared-core` (umbrella over `node-postgres`)                 |
| `Clock`, `Result`, domain errors                                    | `@liam-workspace/platform`                                                 |
| Environment parsing                                                 | `@liam-public/node-config`                                                 |
| Browser OIDC + PKCE                                                 | `@liam-workspace/auth-client`                                              |
| React session binding                                               | `@liam-public/browser-react-auth`                                          |
| Bearer + transparent refresh on 401                                 | `@liam-public/auth-fetch`                                                  |
| Server token verification, passkey ceremony                         | `@liam-workspace/node-auth-server`                                         |
| Passkeys                                                            | `@liam-public/node-webauthn`, `@liam-public/browser-webauthn`              |
| NestJS filters, interceptors, observability                         | `@liam-public/node-nest-common`, `@liam-public/node-nest-observability`    |
| Tailwind v4 + Radix component kit                                   | `@liam-public/browser-react-ui`                                            |
| Offline app-shell and API caching                                   | `@liam-public/vite-preset-pwa`                                             |
| Browser → backend `traceparent`, Web Vitals                         | `@liam-public/browser-telemetry`                                           |
| Error boundary, error reporting, browser logging                    | `browser-react-error-boundary`, `browser-error-reporter`, `browser-logger` |
| Locale text and formatting                                          | `@liam-public/i18n`, `@liam-public/text`                                   |
| Frontend and i18n lint gates                                        | `node-frontend-lint`, `node-i18n-lint`                                     |

There are no `users`, `sessions` or `password` tables to build. Identity is a
verified JWT `sub`; admin is a role claim, which is why revoking admin at the
identity provider takes effect immediately.

Two libraries changed decisions rather than merely implementing them.
**`auth-fetch`** transparently refreshes a bearer token on 401, which is the
mid-attempt expiry risk §7 could previously only flag. **`platform`'s `Clock`**
makes server-authoritative expiry testable by substitution instead of by
sleeping — without it, the lazy-expiry rules are asserted but never exercised.

### Deployment

Two compose services — `api` (serves the built SPA, the REST API and `/media`)
and `postgres` — with a named volume each. `waitForDatabase` gates API boot so
ordering is not a compose race, and `runMigrations` runs at startup with a
scoped `migrationsTable`. Two pools: request-path (5s timeouts,
`applicationName: 'pp:api'`) and a longer-timeout pool (`pp:jobs`) for import, seed and rescore — a 40-question import would be cancelled part-way by the request path's 5s statement timeout.

## 3. Domain

The rename is not cosmetic. `Quiz → Game → Player` becomes
`Test → Attempt → Result`, in the domain layer, from the first commit.

```
TEST ─▶ TEST_VERSION ─┬─▶ TEST_SECTION ─▶ QUESTION_GROUP ─▶ QUESTION ─┬─▶ CHOICE
                      │         │               ▲                     └─▶ QUESTION_TAG
                      │         └─▶ SECTION_INSTRUCTION
                      └─▶ STIMULUS ────────────┘
                             ▲
                       MEDIA_ASSET

STUDENT ─▶ ATTEMPT ─┬─▶ RESPONSE ─┬─▶ RESPONSE_CHOICE ◀─ CHOICE
                    │             └─▶ RESPONSE_CLIENT_CURSOR
                    ├─▶ ATTEMPT_SECTION ◀─ TEST_SECTION
                    └─▶ STIMULUS_PLAY   ◀─ STIMULUS
```

### Stimulus is first-class

Razzia hangs media off an individual question. TOEFL Primary does not work
that way: one recording or one passage carries three or four questions. A
`QUESTION_GROUP` owns an optional `STIMULUS` and its questions, which is the
single structural change that makes the app suitable for language exams.

### Two invariants carry the schema

**A published `test_version` is immutable.** Attempts pin a version, so editing
a test can never move a score already recorded. Enforced by triggers.

**Nothing may cross a version boundary.** Every content and attempt table
carries `test_version_id` and every parent link is a composite foreign key
including it, so an answer to a question from a different version is
unrepresentable. A plain single-column FK would accept one.

Both are proven by `docs/db/invariants.test.sql`, not merely asserted.

### Section rules live in data

`navigation`, `allow_answer_change` and the playback defaults are columns on
`test_section`, not branches in routes. Listening and reading differ only in
their rows: the same `PUT …/position` is accepted in one and refused in the
other, and the navigator's disabled cells are a rendering of what the server
would reject. A stimulus may tighten a section's playback cap, never loosen it
— checked at publication.

## 4. API

Twenty operations across five groups; the full contract is `openapi.yaml`.

```
Session   POST /session · GET /me
Catalog   GET /tests · GET /tests/{slug}
Attempt   POST /attempts · GET /attempts/{id} · POST …/sections/{id}/enter
          POST …/stimuli/{id}/play · PATCH …/responses · PUT …/responses/{qid}
          PUT …/position · POST …/submit
Results   GET …/result · GET …/review · GET /attempts
Admin     GET /admin/failed-writes · POST /admin/tests/import
          POST /admin/tests/{id}/publish · GET …/export · POST /admin/media
```

Decisions worth restating because they were argued and settled:

- **`POST /attempts` is start, resume and re-attempt.** A partial unique index
  constrains only `status = 'in_progress'`, so a submitted attempt never blocks
  a new one and a double-tapped Start races into a constraint. A stale expired
  attempt is finalized and the new one created in the same transaction,
  reported via `finalizedPriorAttempt` — no 410, no retry, and the news of an
  auto-submit is not swallowed.
- **`GET /result` and `GET /review` finalize a past-deadline attempt and return 200.** The thing the caller asked for has just become available; denying it
  would be perverse. `409` is reserved for an attempt genuinely still running.
  Every other route refuses with `410` and carries the finalized attempt.
- **The clock starts at first section entry, not at attempt creation.** Reading
  the brief and the section rules is untimed. Conflating the two charged the
  last section for the time spent reading — the reading section got 24:31 of a
  promised 25:00.
- **`PATCH …/responses` is a full snapshot of ONE section.** Never a delta,
  never the whole attempt. Section expiry is therefore envelope-level, and a
  body spanning two sections is `400 mixed_sections`.
- **A play-capped stimulus carries no `mediaUrl`.** `POST …/play` increments the
  counter and only then issues a signed short-lived URL. The counter guards the
  bytes, not an endpoint nobody is obliged to call.
- **`choice.isCorrect` reaches a student only via `/review`.** Admin export
  returns it deliberately, guarded by the role claim rather than by absence.

## 5. Never lose an answer

Derived from `_bluebik/awesome-survey`, which lost answers four ways: an
all-or-nothing transaction that discarded non-conflicting answers alongside one
conflict; a validation pipe that rejected payloads _before any handler ran_,
leaving no trace; delta payloads that never carried what a missed batch
dropped; and a resume that overwrote unsaved local edits.

1. **Durable before sent.** Every answer is written to IndexedDB on tap and
   cleared only on a per-item ack, never on request completion.
2. **Snapshot, not delta.** A flush carries every answer held for the open
   section, so an answer missed by one batch is carried by the next.
3. **Per-item results, never all-or-nothing.** One rejected item cannot roll
   back the rest, and item failures never fail the envelope.
4. **The server keeps what it refuses.** Anything unapplied — unparseable,
   oversized (413), rejected — is persisted verbatim as a `failed_write`
   _before_ the error is returned, with `capturedAs` naming the row. Oversized
   matters most: it loses the most data while logging the least, so the capture
   falls back to raw bytes when no parsed body exists.
5. **Retry only what is retryable.** Network and 5xx back off; 4xx other than
   429 stop dead and surface. A retried 409 is a storm, not a recovery.
6. **Flush at end of life and before submit.** `pagehide` sends a keepalive
   snapshot, and `POST /submit` carries the queue's remainder in its own body —
   closing the race where the debounced flush is still in flight when Hand in
   is tapped.

### Ordering

Writes are ordered by `(clientInstanceId, seq)`, never by `answeredAt`.
`clientInstanceId` is minted once per install and stored beside the queue;
`seq` increases within that instance across attempts as well as within one. The
server applies a write when `seq` exceeds the stored `seq` **for the same
instance**, and falls back to its own arrival order across instances — the only
sound rule, since two devices share no clock and `answeredAt` is client-supplied.
`response_client_cursor` holds every device's high-water mark, so a queued write
from a device that has since lost the race is still judged stale for its own
instance.

`answeredAt` survives as display text and carries no authority. Neither it nor
`seq` says anything about whether time remained: expiry is judged by the
server's clock on arrival, and `submitted_at` pins to the deadline, never to
arrival.

## 6. Testing

The repository has **zero tests today** — no files, no runner, no script. This
is net-new infrastructure. Match `typescript-libraries`: **vitest**, plus
**testcontainers** for PostgreSQL.

| Layer                | Approach                                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scoring              | Pure unit tests over responses + questions. No database.                                                                                                                          |
| Rule enforcement     | Pure predicates: forward-only, answer-change, max-plays, expiry.                                                                                                                  |
| **Constraint tests** | Real PostgreSQL. Port `docs/db/invariants.test.sql` to vitest: cross-version responses, foreign-question choices, double attempts, double open sections, published-content edits. |
| Repositories         | `loadForRunner()` never returns `is_correct` — asserted explicitly.                                                                                                               |
| Import/export        | Round trip: import → export → deep-equal, including instruction and tag order.                                                                                                    |
| Durability           | Reorder guard discards a lower `seq`; identical re-send is a no-op under `allow_answer_change: false`; a rejected item always names `capturedAs`.                                 |
| API                  | Contract tests including batch partial rejection and `mixed_sections`.                                                                                                            |
| Schema ↔ spec        | A test asserting the SQL enum members equal the OpenAPI enum members, so the two cannot drift silently.                                                                           |

The constraint tests matter more than they look: this design asserts guarantees
the _database_ makes, and an `ALTER TABLE … ADD UNIQUE` that silently did not
apply would leave real belief in protection that is not there.

## 7. Risks

| Risk                                                                                                                                            | Mitigation                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PKCE redirects the whole tab; token expiry mid-attempt would bounce a child out of a running test                                               | `auth-fetch` refreshes transparently on 401; a passkey re-auth needs no redirect at all; and answers are durable locally, so even a redirect cannot lose work                       |
| **NestJS's global `ValidationPipe` throws before any controller runs** — the exact mechanism by which awesome-survey lost answers with no trace | `FailedWriteCaptureFilter` is registered in the same commit as the pipe, falling back to `req.rawBody` when the parsed body is empty. Non-negotiable ordering, called out in plan 2 |
| Two sources of truth — Zod validators for the interchange format, SQL for storage                                                               | The enum-parity test above; import/export round-trip tests                                                                                                                          |
| Assembling a runner payload is a six-join read                                                                                                  | One well-tested `TestVersionRepository.load()`; that shape must not leak upward                                                                                                     |
| A published test cites a deleted asset                                                                                                          | `ON DELETE RESTRICT` on `stimulus.media_asset_id`                                                                                                                                   |
| Two attempts on one test may span versions and are not strictly comparable                                                                      | History renders the version; `test_version.title` is what a pinned attempt reads                                                                                                    |
| Immutability triggers block a legitimate content fix                                                                                            | Fix by publishing a new version; that is what versions are for                                                                                                                      |

## 8. Build order

| Phase | Deliverable                                                                                                                                                                                                                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Scaffold `packages/{common,db}` on `shared-core` + `platform`; two registries in `.npmrc`; compose with Postgres; vitest + testcontainers. (`server` and `app` are scaffolded by the plans that first put code in them; `socket` and `web` are deleted in plan 3, so the repo stays runnable throughout) |
| 1     | Migrations from `schema.sql`; repositories; constraint tests green                                                                                                                                                                                                                                       |
| 2     | Session, catalog and attempt-start endpoints; import/export/publish; seed a real test                                                                                                                                                                                                                    |
| 3     | Runner payload, section entry, play, position; the listening and reading screens                                                                                                                                                                                                                         |
| 4     | The durable write path: queue, snapshot flush, reorder guard, `failed_write`, retry classification                                                                                                                                                                                                       |
| 5     | Submit, grading, result, review, history                                                                                                                                                                                                                                                                 |
| 6     | Navigator, menu, i18n sweep, iPad polish, Docker deploy                                                                                                                                                                                                                                                  |

Phase 4 is the one to resist compressing. Every rule in §5 exists because it
was learned the expensive way somewhere else.

## 9. Provenance

Razzia is MIT-licensed; the fork retains the copyright and licence notice.
Upstream stays configured as `upstream` so generic React fixes can be pulled,
but the fork is a derivative application and does not aim to stay behaviourally
compatible.

Design converged under adversarial review: the prototype over twelve rounds
(23 → 13 → 6 → 6 → 5 → 3 → 2 → 11 → 8 → 2 → 1 → 0 findings), then all
documents together over five more (16 → 13 → 9 → 2 → 0). Roughly half the
later findings were regressions introduced by earlier fixes, which is the
argument for reviewing to convergence rather than reviewing once.
