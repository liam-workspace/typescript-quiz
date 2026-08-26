# What plan 2 inherits

Six things plan 1 leaves undone on purpose. Each was found late, judged out of
scope for a foundation plan, and deferred — but deferring silently is how a
known problem becomes a surprise. Each section says what is true today, why it
was not fixed here, and the concrete first action plan 2 owes it.

## 1. Nothing here is loadable by Node outside vitest

Both packages declare `"exports": { ".": "./src/index.ts" }` — no build, no
`dist/`, no `types`. The `.ts` sources use `.js` relative specifiers
(`./domain/ids.js`), which Node resolves literally against files that do not
exist. Verified from `packages/db`: a plain `import`,
`--experimental-strip-types` and `require` all fail identically with

```
ERR_MODULE_NOT_FOUND Cannot find module .../packages/common/src/domain/ids.js
imported from .../packages/common/src/index.ts
```

Only Vite's resolver loads these packages today, which is why every test passes
and nothing else runs. Spec §2 has `runMigrations` running at API startup and
`migrateToLatest` lives in `@pp/db`, so the server cannot start until this is
fixed.

**First action (plan 2, task 1):** add build scripts emitting `dist/`, repoint
`exports` and `types` at the built output, and check that `migrate.ts`'s
`resolve(here, "../migrations")` still lands on the migrations directory from
`dist/`. Decide ESM vs CJS for the server before writing it — `@pp/db` is
`"type": "module"`.

## 2. `oxlint.config.ts` rejects idiomatic NestJS

Probed with a NestJS-shaped file. Five rules fire on code every NestJS project
writes:

| Rule                             | Fires on                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `typescript/no-extraneous-class` | every `@Module()` class (they have no members)                                         |
| `max-params: 3`                  | any provider with four injected dependencies                                           |
| `class-methods-use-this`         | guards, pipes, interceptors                                                            |
| `max-classes-per-file`           | a module and its provider in one file                                                  |
| `new-cap`                        | every decorator application — `@Injectable()` is a call to an uppercase-named function |

`oxlint --fix` cannot help with any of them; each needs a config decision, not
a rewrite. `new-cap` is the widest: it fires once per decorator, so it lands on
essentially every line of NestJS boilerplate.

**First action (plan 2, task 1):** decide per-directory `overrides` for the
server package up front, so the first commit of server code is not also a lint
config negotiation.

## 3. `moduleResolution: "bundler"` in both package tsconfigs

The server will want `node16`/`nodenext`. This matters beyond taste: under
`bundler`, TypeScript never validates the `.js` extensions these packages ship,
which is exactly why item 1 survived eleven tasks and eleven reviews without
anyone noticing. Switching resolution mode will surface every specifier at
once.

**First action (plan 2, task 1):** switch the server package to
`node16`/`nodenext` and expect the two library packages to follow, since the
extension checking is the point of the switch, not a side effect.

## 4. Scoring and Runner projections share one entry point

`packages/common/src/index.ts` exports `ScoringChoice`/`ScoringQuestion`
alongside the Runner types, and `packages/db/src/index.ts` `export *`s
`loadForScoring` — the query that selects `is_correct` — from the same entry
point as `loadForRunner`. The answer key is absent from the runner payload by
construction, which is the property that actually matters and is tested. But
nothing stops a future student-facing route from importing the scoring
projection: there is no module boundary, only a convention and a docstring.

**First action (plan 2):** plan 2 defines the service layer, so give it an
explicit task to draw that boundary — a separate entry point (or a lint rule
naming who may import what) rather than a comment asking nicely.

## 5. The wire contract carries three fields the projection does not

`docs/api/openapi.yaml`'s `RunnerSection` schema requires `status`,
`completedAt` and `expiresAt`. The `RunnerSection` **projection** in
`packages/common/src/domain/test.ts` no longer has them: `loadForRunner`
invented them as constants (`"pending"`, `null`, `null`) on every section
regardless of attempt, so they were dropped rather than filled in with a
speculative `attempt_section` join that plan 1 has no rows for.

This is not drift to be reconciled by editing one side. The three fields
genuinely belong in the HTTP response, and the layers are allowed to differ:
the projection is what the content query can know, the response is what the
student needs. What must not happen is someone reading them off the projection
and finding nothing there.

**First action (whoever builds the runner endpoint):** compose the three from
attempt state — `attempt_section` — alongside the projection, rather than
expecting `loadForRunner` to supply them. If they ever do become part of the
projection, it is with a real join, not constants.

## 6. The Docker image and `pnpm build`/`dev`/`start` are broken

`Dockerfile` copies the `packages/web` and `packages/socket` manifests but not
`packages/db`, then installs against a `pnpm-workspace.yaml` that lists
`packages/db`. `pnpm build` now iterates only `common` and `db`, neither of
which defines a `build` script, so it fails outright:

```
[ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT] None of the selected packages has a "build" script
```

which leaves `COPY --from=builder /app/packages/web/dist` with nothing to copy.
`docker-release.yml` builds this on every published release.

**Ruling: accepted, not fixed here.** Repairing the Dockerfile means deciding
`socket`/`web`'s fate, which a named later plan owns, and the repository has no
runnable application on this branch regardless. Cost if that is wrong: a
release cut from this branch fails its image build — visible immediately, and
nothing is released from `develop`.

**First action (plan 2 or later):** repair the Dockerfile in the same change
that gives the repository a runnable application again, so the image build is
verified against something that exists rather than re-guessed.
