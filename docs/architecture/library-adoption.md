# Library adoption map

A verdict on every one of the 47 packages in `~/projects/typescript-libraries`.

The goal is maximum genuine reuse. Six packages are declined on grounds that
adopting them would make the design _worse_, not merely redundant — each says
why in one line. Everything else is either adopted now, adopted in a named
later plan, or has no subject matter in common with this app.

**Registries.** `@liam-public/*` resolves from npmjs.org; `@liam-workspace/*`
from npm.pkg.github.com and needs a `NODE_AUTH_TOKEN` — the name `.npmrc`
actually reads, and the one `actions/setup-node` sets. Both scopes must be in
`.npmrc` before `pnpm install` will resolve anything below.

**Carried into plan 2.** Six things this plan leaves undone on purpose — the
packages not being loadable by Node, the lint config's quarrel with NestJS,
`moduleResolution`, the Scoring/Runner entry point, the three runner fields the
wire contract carries but the projection does not, and the broken image build —
are written down in `docs/architecture/plan-2-preconditions.md`.

---

## Adopted — foundation (plan 1)

| Package                      | Used for                                                                                                                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@liam-public/node-postgres` | `^0.3.1`, direct dependency. `createPool`, `withTransaction`, `runMigrations`, `waitForDatabase`; named explicitly because the two-pool policy, `runMigrations`' scoped `migrationsTable`, and `createPool`'s `applicationName` knob are load-bearing decisions, not incidental. |
| `@liam-workspace/platform`   | `Clock` / `createFixedClock`, `Result`/`ok`/`err`, `NotFoundError`/`ValidationError`/`ConflictError`.                                                                                                                                                                            |
| `@liam-public/node-config`   | `parseIntegerEnv`, `parseBooleanEnv`, `parseCsvEnv` for `PORT`, `MEDIA_MAX_BYTES`, `ALLOWED_EMAILS`.                                                                                                                                                                             |
| `@liam-public/node-logger`   | Structured logging.                                                                                                                                                                                                                                                              |
| `@liam-public/event-bus`     | `DomainEventEnvelope` for `attempt.submitted`, `write.captured`.                                                                                                                                                                                                                 |

`Clock` is the one worth calling out. Every clock in this app is
server-authoritative, and `createFixedClock` turns expiry tests from
`await sleep(50 * 60_000)` into an assertion. Nothing else in the design makes
lazy expiry cheaply testable.

**Reversal record.** `@liam-public/shared-core` was adopted first, as the
umbrella re-export for `node-postgres`, `node-logger`, and friends. It was
REVERSED during Task 2 of the foundation-db-and-domain plan: the npm registry
marks `@liam-public/shared-core` deprecated ("Use capability-specific @liam
packages instead"), and the published `shared-core@0.2.1` pins
`@liam-public/node-postgres` to an exact `0.2.0` — not a range — whose
`CreatePoolOptions` predates the `applicationName` knob. That silently dropped
the ability to tag pooled connections with `application_name`, which
`pg_stat_activity`-based incident triage depends on. The fix was to depend on
`@liam-public/node-postgres@^0.3.1` directly instead of reaching it through the
umbrella; the table above reflects that as the standing decision.

## Adopted — server (plan 2)

| Package                                | Used for                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `@liam-workspace/node-auth-server`     | `createJwksVerifier`, `decodeServiceJwt`, `isEmailAllowed`, and `createPasskeyAuth`. |
| `@liam-public/node-webauthn`           | Server half of the passkey ceremony, behind `createPasskeyAuth`.                     |
| `@liam-public/node-nest-common`        | `AllExceptionsFilter`, `LoggingInterceptor`.                                         |
| `@liam-public/node-nest-observability` | `ObservabilityModule`, `HttpMetricsInterceptor`, `initOtel`, `PrometheusModule`.     |

**A hazard to wire on day one, not later.** awesome-survey lost answers because
NestJS's global `ValidationPipe` threw `BadRequestException` _before any
controller ran_ — no handler, no log, no row. Choosing NestJS inherits that
failure mode. The `FailedWriteCaptureFilter` must therefore be registered in
the same commit that registers the pipe, and must fall back to `req.rawBody`
when the parsed body is empty, exactly as their rescue filter does.

## Adopted — client (plans 4–5)

| Package                                     | Used for                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `@liam-workspace/auth-client`               | OIDC authorization-code + PKCE against `auth.icovn.me`.                                                                              |
| `@liam-public/browser-react-auth`           | `AuthProvider`, `useAuth`, `createAuthenticatedFetch`.                                                                               |
| `@liam-public/browser-webauthn`             | Passkey registration and login ceremonies.                                                                                           |
| `@liam-public/auth-fetch`                   | Bearer injection with **transparent refresh on 401**. This is the spec's stated mid-attempt-expiry risk, already solved.             |
| `@liam-public/browser-react-ui`             | Tailwind v4 + Radix kit: `button`, `card`, `dialog`, `input`, `select`, `table`, `badge`, `separator`, `dropdown-menu`, **`sheet`**. |
| `@liam-public/browser-react-error-boundary` | Error boundary with reset + reporting hooks.                                                                                         |
| `@liam-public/browser-error-reporter`       | `initErrorReporter`, `reportError` — batching and global capture.                                                                    |
| `@liam-public/browser-logger`               | Scoped levels with remote forwarding.                                                                                                |
| `@liam-public/browser-telemetry`            | W3C `traceparent` propagation browser → backend, plus Core Web Vitals.                                                               |
| `@liam-public/vite-preset-pwa`              | Offline app-shell, `NetworkFirst` API caching, standalone manifest.                                                                  |
| `@liam-public/i18n`                         | `MultilingualText`, `translate` across the six locales.                                                                              |
| `@liam-public/text`                         | `formatPercentage`, `formatNumber`, `selectText` for scores and dates.                                                               |
| `@liam-public/http-client`                  | Universal fetch client under `auth-fetch`.                                                                                           |

Three of these change earlier decisions:

**`browser-react-ui` replaces the harvest.** Plan 1 said to copy Razzia's
`components/*` into `packages/app`. It shouldn't: Razzia is already Tailwind v4
and Radix, so the kit is the same stack with the same primitives, already tested
and maintained. `sheet` is literally the collapsible drawer the prototype draws
by hand. Only `QuestionMedia` and `branding.ts` are still worth copying.

**`vite-preset-pwa` is not a nice-to-have here.** The durability design assumes
a child keeps answering while the network is gone. A service worker with an
offline app-shell is what makes that true of the _page_, not just of the
answer queue — without it, a reload during an outage shows a browser error and
the queue never gets a chance to flush.

**`browser-telemetry` closes the loop the durability rules open.** awesome-survey
had to add end-to-end tracing specifically to debug the answer-save path
(`fix(capability): trace the answer-save path`). A `traceparent` that survives
from tap to `failed_write` row means "which write vanished" is a query rather
than an investigation.

## Adopted — tooling (plan 1, CI gates)

| Package                            | Used for                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `@liam-public/node-frontend-lint`  | Audits the layered React frontend: stateless components, one-way imports.                    |
| `@liam-public/node-i18n-lint`      | Detects hardcoded untranslated strings in TSX. With six locales, the failure mode is silent. |
| `@liam-public/node-dev-tools`      | Git / Docker / release workflow utilities for `scripts/`.                                    |
| `@liam-public/node-slack-notifier` | Ops alert on a `failed_write` spike. A capture nobody looks at is a log, not a safety net.   |

## Adopted later — the admin spec

| Package                             | Why it waits                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@liam-workspace/browser-react-cms` | App-shell, auth guards, dark mode, toasts, Zod forms, data-table. This is the authoring editor, which is a separate spec.                                                                      |
| `@liam-public/browser-react-data`   | `DataProvider` + TanStack Query CRUD hooks — shaped for CMS resources. The student runner is not CRUD (an attempt is a lifecycle, not a resource), so it fits the admin side and not this one. |
| `@liam-public/cms-contracts`        | The Zod list/CRUD contract `browser-react-data` speaks. Same reasoning.                                                                                                                        |

## Declined — adopting these would make the design worse

| Package                                 | Why not                                                                                                                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@liam-public/node-drizzle-postgres`    | Competes with `node-postgres`. The schema depends on triggers, partial unique indexes and composite foreign keys — the parts of PostgreSQL an ORM migration generator handles worst. Raw SQL + `node-pg-migrate` keeps `schema.sql` as the single authority. |
| `@liam-workspace/platform`'s `EntityId` | Adopted the module, **not this class.** Ids come from `gen_random_uuid()` and cross the wire as strings; wrapping them in a class means mapping on every read and write for safety branded string types already give. The rest of `platform` is adopted.     |
| `@liam-public/node-nest-cache`          | Redis, which the spec rules out of v1 scope (§1). A single-family deployment has nothing to cache that Postgres does not already serve in under a millisecond.                                                                                               |
| `@liam-public/json-logic-whitelist`     | Configurable rule evaluation. Section rules are four columns with fixed semantics; a rule engine would make them dynamic, which is the opposite of what publication-time validation needs.                                                                   |
| `@liam-public/node-browser-automation`  | Puppeteer with stealth and a proxy pool. E2E here is Playwright against a local server; stealth and proxies are for scraping.                                                                                                                                |
| `@liam-public/browser-vietnamese-ime`   | Telex/VNI input. Every text field a student touches is English by construction — this is an English exam. Reconsider if the admin editor ever takes Vietnamese content notes.                                                                                |

## No subject matter in common

`glicko2-doubles` (match ratings) · `node-gitlab-client` · `node-defectdojo-client` ·
`node-cloudflare-client` · `node-google-sheets-client` · `node-microsoft-graph-client` ·
`node-messaging` (WhatsApp channels) · `node-pty-session` (terminal websockets) ·
`node-fizzy-client` · `@liam-workspace/node-platform` · `react-native-auth` ·
`react-native-secure-storage` (no mobile app in scope).

---

## Count

| Verdict                        | Packages |
| ------------------------------ | -------- |
| Adopted now or in a named plan | **28**   |
| Deferred to the admin spec     | 3        |
| Declined with reason           | 6        |
| No subject matter in common    | 12       |
| Total surveyed                 | **47**   |

Two of the 47 became load-bearing rather than convenient: `auth-fetch` solves a
risk the spec had only flagged, and `platform`'s `Clock` is what makes
server-authoritative expiry testable without sleeping.
