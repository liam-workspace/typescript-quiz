# TOEFL Primary practice tests

A private, single-family practice-test platform for the TOEFL Primary exam. A
student signs in, picks a published test, sits it under timed exam
conditions, hands it in, and afterwards sees a score and reviews their
answers.

> **Provenance**: this project began as a fork of
> [Razzia](https://github.com/Ralex91/Razzia), Ralex91's open-source live
> quiz platform, MIT-licensed (see [LICENSE](LICENSE)). The original
> real-time, host-driven quiz has since been replaced end to end with an
> asynchronous test runner — see
> [`docs/superpowers/specs/2026-08-25-toefl-primary-fork-design.md`](docs/superpowers/specs/2026-08-25-toefl-primary-fork-design.md)
> for the design behind the rewrite.

## 🧩 What is this project?

- Sign-in goes through `auth.icovn.me` (Google or Microsoft), and a
  student's profile IS the account — there are no local passwords.
- A test is split into sections: **listening** (each recording plays once,
  forward-only, no pause or seek) and **reading** (free navigation between
  questions).
- Timers, autosave, resume after a reload or dropped connection, auto-submit
  on expiry, and grading are all server-authoritative.
- After hand-in a student sees a score and can review every answer,
  including ones left blank; past attempts are kept in a per-test history.
- Tests reach the database by JSON import (`pnpm import:toefl-primary`, or
  `POST /admin/tests/import`) — there is no authoring UI yet.

## 🧱 Packages

Four workspace packages, built in this order:

| Package           | What it is                                                            |
| ----------------- | ---------------------------------------------------------------------- |
| `packages/common` | Domain types and Zod validators for the test JSON interchange format |
| `packages/db`     | Migrations and repositories (`@liam-public/node-postgres`)           |
| `packages/server` | NestJS REST API — JWKS verification, grading, media signing          |
| `packages/app`    | The React 19 + Vite single-page app                                  |

## ⚙️ Prerequisites

### Without Docker

- Node.js 24 (the Dockerfile is pinned to `node:24-alpine`; nothing here has
  been run against a newer major)
- pnpm 11 (the Dockerfile installs `pnpm@11.1.1` exactly)
- Your own PostgreSQL 16 instance — the server runs its own migrations at
  startup, so nothing further is needed once `DATABASE_URL` points at one
- A GitHub Packages read token in `NODE_AUTH_TOKEN` — `.npmrc` resolves the
  `@liam-workspace` scope from `npm.pkg.github.com`, and `pnpm install`
  fails without it

### With Docker

- Docker and Docker Compose
- The same `NODE_AUTH_TOKEN`, passed as a build secret (see `compose.yml`)

## 📖 Getting Started

### 🐳 Using Docker Compose (recommended)

[`compose.yml`](compose.yml) builds one image (`api`) that serves the REST
API, `/media`, and the built SPA from a single Node process, alongside a
`postgres` service for local development.

A handful of variables have no default, and `docker compose up` refuses to
start without them — export them or put them in a `.env` file next to
`compose.yml`:

```bash
export NODE_AUTH_TOKEN=...            # GitHub Packages read token (build secret)
export POSTGRES_PASSWORD=...
export VITE_AUTH_ISSUER=https://auth-dev.icovn.me
export VITE_AUTH_CLIENT_ID=...
export VITE_AUTH_REDIRECT_URI=...     # must match a redirect URI registered with the issuer, exactly
export MEDIA_SIGNING_SECRET=...

docker compose up -d
```

The `VITE_AUTH_*` values are baked into the SPA bundle at **build** time —
Vite inlines `import.meta.env.VITE_*` and never reads it from the running
container. Building through `compose.yml` as above passes them as build
args, so changing them here means rebuilding the image; an image built
without those args instead ships the literal placeholders
`__VITE_AUTH_ISSUER__` etc., and `docker-entrypoint.sh` substitutes the real
values into the built SPA at container start (failing closed if any is
unset) — which is how the same image is deployed to more than one
environment. `JWKS_URL` defaults
to the production issuer; `ALLOWED_EMAILS` defaults to empty, which rejects
every sign-in until it is set — see the comments in `compose.yml` for both.

The application will be available at http://localhost:3000.

### 🛠️ Without Docker

1. Clone the repository:

```bash
git clone <repo-url>
cd typescript-quiz
```

2. Install dependencies (`NODE_AUTH_TOKEN` must be set — see Prerequisites):

```bash
pnpm install
```

3. Build and run:

```bash
# Development mode — reads a root .env file (via dotenv-cli); at minimum
# that needs DATABASE_URL, JWKS_URL and MEDIA_SIGNING_SECRET (see
# packages/server/src/config.ts), plus the VITE_AUTH_* values for the app.
pnpm dev

# Production mode
pnpm build
pnpm start
```

## 📚 Documentation

Full index in [docs/](docs/README.md).
