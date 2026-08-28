# Screen 1 — Sign in (`#s-signin`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A child opens the app on the family iPad, taps one button, signs in through `auth.icovn.me`, and lands in the library with a provisioned profile. Today the app has no sign-in at all: `getDevBearerToken()` reads `VITE_DEV_BEARER_TOKEN` from the build environment, so a production build cannot make an authenticated request and an adult must mint a JWT by hand.

**Prototype:** `docs/prototype/index.html` `#s-signin`. Copy is settled apart from one point: _"Primary Practice — Listening and reading practice tests for TOEFL Primary, Steps 1 and 2"_, one sign-in button, and the reassurance _"You will be taken to auth.icovn.me to sign in, then brought straight back here."_

**Spec:** `docs/superpowers/specs/2026-08-25-toefl-primary-fork-design.md`.

## The identity provider (owner-confirmed, and verified live)

|                    |                             |
| ------------------ | --------------------------- |
| Production issuer  | `https://auth.icovn.me`     |
| Development issuer | `https://auth-dev.icovn.me` |
| Accounts           | **Google _and_ Microsoft**  |

Both issuers were probed and answer a standard OIDC discovery document at
`/.well-known/openid-configuration`. Confirmed, not assumed:

- `authorization_endpoint` `/auth`, `token_endpoint` `/token`, **`jwks_uri` `/jwks`** — so the server's `JWKS_URL` is `https://auth-dev.icovn.me/jwks` in development.
- `code_challenge_methods_supported: ["S256"]` — PKCE as the prototype specifies.
- `scopes_supported` includes `offline_access`, so a **refresh token is obtainable**. Use it. The difference between a refresh token and none is a child being signed out in the middle of a timed test.
- `end_session_endpoint` and `revocation_endpoint` exist — sign-out should use them rather than only dropping the local token.

**One button, not two.** Discovery exposes no provider/connection/idp parameter, so the gateway presents its own Google-or-Microsoft chooser. The app sends one authorize request and lets `auth.icovn.me` handle the choice. **Therefore the prototype's "Continue with Google" copy is now wrong** — it predates Microsoft support. Use provider-neutral copy ("Sign in", "Continue"), and do not name a single provider in any of the six locales.

## BLOCKER — an OIDC client must be registered before Task 2 can finish

A probe of `auth-dev.icovn.me/auth` with the prototype's `client_id=primary-practice` and `redirect_uri=http://localhost:5173/auth/callback` returns **400**. Either that client id is not registered or that redirect URI is not allowed — the prototype invented the name and nothing has ever run against the real service.

Needed from the owner, for BOTH issuers:

1. the real `client_id` for this app;
2. allowed `redirect_uri` values — at minimum the local dev origin and the deployed origin;
3. confirmation that it is registered as a **public** client (a browser SPA holds no secret, which is what PKCE is for).

Tasks 1 and 3 do not depend on this and can proceed. **Do not work around a 400 by disabling PKCE, by inventing a different client id, or by falling back to the dev token.** Stop and report.

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

1. No OIDC client. The prototype names `@liam-workspace/auth-client`; **it is not installed** — confirm whether it is reachable from this registry before designing around it. If it is not, a hand-rolled PKCE flow against the discovery document above is viable (the endpoints and S256 support are confirmed) but materially larger: say so in your report rather than silently absorbing it.
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
- [ ] **Step 2: Failing test** for a `startSignIn()` that builds the authorize URL with `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email profile roles offline_access`, and an S256 `code_challenge`, and persists the verifier for the callback. Read the issuer from configuration, never a hardcoded host: dev and production differ by one value and must not differ by a code change.
- [ ] **Step 3: Failing test** for `completeSignIn(code)`: exchanges the code with the verifier, stores the resulting token, then calls `POST /api/session` **once**, and returns the profile. Assert the ORDER: the session call cannot precede a token.
- [ ] **Step 4:** Implement both. `POST /api/session` returns `200` for an existing student and `201` when provisioned; both are success. `403` means the email is not on the allowlist — that is a real, renderable state, not an error to swallow, and with two account types it is the likely outcome of signing in with the wrong one.
- [ ] **Step 5: Failing test** for refresh: an expired access token is refreshed using the stored refresh token WITHOUT sending the child back to sign-in, and a failed refresh falls back to sign-in cleanly. This is the reason `offline_access` is requested; a child must not be ejected from a timed test by an hour-old token.

### Task 3: The sign-in screen and callback route

- [ ] **Step 1: Failing test** for `packages/app/src/pages/sign-in.tsx`: renders the prototype's title and subtitle, and ONE provider-neutral sign-in button that calls `startSignIn`. Assert the copy does not name Google or Microsoft — the gateway chooses, and naming one of two supported providers is a lie to whoever holds the other.
- [ ] **Step 2: Failing test** for `packages/app/src/pages/auth.callback.tsx`: on mount with `?code=`, calls `completeSignIn` and navigates to `/`; on `403` renders "this account cannot use this app" without a retry loop; on any other failure offers one honest retry back to sign-in.
- [ ] **Step 3:** Implement both, six locales.

### Task 4: Guard every other route

- [ ] **Step 1: Failing test:** visiting a protected route with no token lands on sign-in, and the intended destination is remembered and returned to after sign-in.
- [ ] **Step 2:** Implement the guard once, at the root, not per route.
- [ ] **Step 3: Failing test:** a `401` from any API call clears the store and returns to sign-in rather than leaving a child on a dead screen with a running clock. **Careful:** a `401` mid-test must not silently discard queued answers — they live in IndexedDB and must still be there after re-authentication. Assert that.

### Task 5: End to end against the real stack

- [ ] `docker compose up` with `JWKS_URL=https://auth-dev.icovn.me/jwks` and `ALLOWED_EMAILS` covering the family accounts. Sign in with a Google account AND with a Microsoft account; confirm `POST /api/session` provisions each, `GET /api/me` returns the profile, and a protected route loads. Record what you observed, not what you expected — including which provider the gateway offered and in what order.

## Definition of Done

- [ ] All four gates exit 0.
- [ ] A production build with **no** `VITE_DEV_BEARER_TOKEN` can sign in and reach a protected route.
- [ ] No token appears in a URL, a log, or a test fixture committed to the repo.
- [ ] `403` (not allowed), `401` (expired) and a failed exchange each render something a child can read and act on.
- [ ] Queued answers survive a mid-test `401` and re-authentication.
