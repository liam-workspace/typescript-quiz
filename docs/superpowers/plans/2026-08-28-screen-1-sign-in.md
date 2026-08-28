# Screen 1 — Sign in (`#s-signin`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A child opens the app on the family iPad, taps one button, signs in with the family Google account through `auth-dev.icovn.me`, and lands in the library with a provisioned profile. Today the app has no sign-in at all: `getDevBearerToken()` reads `VITE_DEV_BEARER_TOKEN` from the build environment, so a production build cannot make an authenticated request and an adult must mint a JWT by hand.

**Prototype:** `docs/prototype/index.html` `#s-signin`. Copy is settled: _"Primary Practice — Listening and reading practice tests for TOEFL Primary, Steps 1 and 2"_, a single **Continue with Google** button, and the reassurance _"You will be taken to auth.icovn.me to sign in, then brought straight back here."_

**Spec:** `docs/superpowers/specs/2026-08-25-toefl-primary-fork-design.md`. Identity is the Google account itself — profile and account are one and the same.

---

## What already exists (verify before building)

The backend for this screen is **complete**. Do not rebuild it.

| Endpoint                                 | Status      | Where                                         |
| ---------------------------------------- | ----------- | --------------------------------------------- |
| `POST /api/session` (`establishSession`) | Implemented | `session.controller.ts:40`, contract line 89  |
| `GET /api/me` (`getMe`)                  | Implemented | `session.controller.ts:55`, contract line 131 |
| Bearer verification against `JWKS_URL`   | Implemented | `auth/jwks.guard.ts`, `auth/auth.module.ts`   |
| Email allowlist (`ALLOWED_EMAILS`)       | Implemented | `config.ts:39`                                |

`packages/app/src/lib/session-api.ts` already has `getCurrentStudent()` for `GET /me`. There is **no** client for `POST /session`.

## What is missing

1. No OIDC client. The prototype names `@liam-workspace/auth-client`; **it is not installed** — confirm whether it is reachable from this registry before designing around it. If it is not, the fallback is a hand-rolled PKCE flow, which is a materially larger task: say so in your report rather than silently absorbing it.
2. No `/auth/callback` route to receive `?code=` and exchange it.
3. No token store. `dev-auth.ts` must become one implementation of an interface, not the only path.
4. No sign-in screen.
5. No route guard: every existing route assumes a token already exists.

## Global Constraints

- **`pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test` all exit 0 at the end of every task**, run CHAINED. Never `git add -A`; never commit.
- **Never put a token in a URL, in `localStorage` under a guessable key, or in a log line.** A bearer token for a child's account is a credential.
- `packages/app/src/components/` is STATELESS and props-only — `frontend-lint` hard-rejects `useState`/`useEffect` there. Auth state lives in a page or a `src/lib/` module.
- All user-visible strings go through i18next, FLAT dotted keys, all six locales under `packages/app/src/locales/{de,en,es,fr,it,ja}/`, with real translations.
- Interactive targets in this app are `size-11` (44px).
- **Do not weaken the server's auth to make a test pass.** No dev bypass on a route, no "skip verification in test" flag. `createTestApp` already mints real RS256 tokens and overrides the JWKS verifier with an injected `fetchFn` — follow that pattern.

## Tasks

### Task 1: A token store with a real interface

- [ ] **Step 1: Failing test.** `packages/app/test/tokenStore.test.ts`: a store returns null when empty, returns what was saved, clears on sign-out, and survives a reload (persisted, not in-memory-only).
- [ ] **Step 2: Implement** `packages/app/src/lib/tokenStore.ts`. Decide persistence deliberately and write the reason in a doc comment: `sessionStorage` loses the session when the iPad's Safari tab is recycled mid-test; `localStorage` persists a credential on a shared family device. State the tradeoff you chose and why.
- [ ] **Step 3:** Make `getDevBearerToken()` one _fallback_ branch behind the store rather than the primary source, so a dev token still works locally and never shadows a real session.

### Task 2: The OIDC round trip

- [ ] **Step 1:** Confirm `@liam-workspace/auth-client` installs. If it does not, STOP and report — do not hand-roll PKCE without saying so.
- [ ] **Step 2: Failing test** for a `startSignIn()` that builds the authorize URL with `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email profile roles`, and an S256 `code_challenge`, and persists the verifier for the callback.
- [ ] **Step 3: Failing test** for `completeSignIn(code)`: exchanges the code with the verifier, stores the resulting token, then calls `POST /api/session` **once**, and returns the profile. Assert the ORDER: the session call cannot precede a token.
- [ ] **Step 4:** Implement both. `POST /api/session` returns `200` for an existing student and `201` when provisioned; both are success. `403` means the email is not on the allowlist — that is a real, renderable state, not an error to swallow.

### Task 3: The sign-in screen and callback route

- [ ] **Step 1: Failing test** for `packages/app/src/pages/sign-in.tsx`: renders the prototype's title, subtitle and single button; the button calls `startSignIn`.
- [ ] **Step 2: Failing test** for `packages/app/src/pages/auth.callback.tsx`: on mount with `?code=`, calls `completeSignIn` and navigates to `/`; on `403` renders "this account cannot use this app" without a retry loop; on any other failure offers one honest retry back to sign-in.
- [ ] **Step 3:** Implement both, six locales.

### Task 4: Guard every other route

- [ ] **Step 1: Failing test:** visiting a protected route with no token lands on sign-in, and the intended destination is remembered and returned to after sign-in.
- [ ] **Step 2:** Implement the guard once, at the root, not per route.
- [ ] **Step 3: Failing test:** a `401` from any API call clears the store and returns to sign-in rather than leaving a child on a dead screen with a running clock. **Careful:** a `401` mid-test must not silently discard queued answers — they live in IndexedDB and must still be there after re-authentication. Assert that.

### Task 5: End to end against the real stack

- [ ] `docker compose up`, `JWKS_URL` pointed at `auth-dev.icovn.me`, sign in as the real family account, confirm `POST /api/session` provisions, `GET /api/me` returns the profile, and a protected route now loads. Record what you observed, not what you expected.

## Definition of Done

- [ ] All four gates exit 0.
- [ ] A production build with **no** `VITE_DEV_BEARER_TOKEN` can sign in and reach a protected route.
- [ ] No token appears in a URL, a log, or a test fixture committed to the repo.
- [ ] `403` (not allowed), `401` (expired) and a failed exchange each render something a child can read and act on.
- [ ] Queued answers survive a mid-test `401` and re-authentication.
