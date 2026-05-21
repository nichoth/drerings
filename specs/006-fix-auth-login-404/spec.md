# Feature Specification: atproto Sign-In 404 Recurrence (`/api/auth/login`)

**Feature Branch**: `006-fix-auth-login-404`
**Created**: 2026-05-21
**Status**: Draft
**Input**: User description: "Getting a 404 on the login with oauth flow"

## Context

The same user-facing symptom that motivated feature `005-fix-auth-login-404`
has resurfaced. Visiting `http://127.0.0.1:8888/api/auth/login?handle=
jarving.bsky.social` in the local development environment returns the bare
text `Function not found...` instead of redirecting the user to their PDS to
begin the atproto OAuth authorize flow.

This blocks sign-in entirely. Since sign-in is the only authentication path
in the product, the entire authenticated surface (sending postcards, sharing
drawings, viewing the account page, purchasing or gifting stamps) is
unreachable to any user who is not already holding a valid `drerings_auth`
session cookie.

The prior fix (branch `005-fix-auth-login-404`, merged into `staging`)
moved the auth function files to a flat layout (`auth-login.ts`,
`auth-callback.ts`, `auth-logout.ts` in `netlify/functions/`) and added
redirect rules in `netlify.toml`. The recurrence suggests one or more of:

1. The fix is fragile and breaks under a common developer workflow
   (cold start, file-watch reload, branch switch, dependency change).
2. There is a second routing path that was not covered by the first fix.
3. A subsequent change re-introduced the original defect.

Whichever applies, the user-observable contract is the same: the login
endpoint MUST reach the application handler on every request, in every
supported environment.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign-in works on every fresh dev-server start (Priority: P1)

A contributor pulls the latest `staging` branch, starts the local dev server,
opens the app, enters their Bluesky handle, and is redirected to their PDS to
authorize. The flow completes and they return signed in. No "Function not
found" page appears at any step. This must hold for the very first request
after the dev server starts (no warm-up request required) and for every
subsequent request during the same dev-server session.

**Why this priority**: Sign-in is the gate to every authenticated feature.
Until this works reliably, contributors cannot manually verify any
authenticated feature locally, and end users cannot use the product at all.
This is the only user story in scope.

**Independent Test**: From a clean checkout of the branch that fixes this
bug, run the standard local dev command. In a fresh browser profile (no
`drerings_auth` cookie), open `/` and click sign-in (or visit
`/api/auth/login?handle=<valid-handle>` directly) as the first network
request after server start. The response MUST be an HTTP redirect to the
user's PDS authorize URL, NOT a "Function not found" page. Repeat after
restarting the dev server with no code changes — the result MUST be the
same.

**Acceptance Scenarios**:

1. **Given** a freshly started local dev server with no prior requests,
   **When** the first request hits `/api/auth/login?handle=<valid-handle>`,
   **Then** the response is an HTTP redirect to the PDS authorize URL (not
   a "Function not found" body).
2. **Given** a local dev server that has been running for some time,
   **When** any number of subsequent requests hit `/api/auth/login` with a
   valid handle, **Then** every response reaches the application handler
   (302, 400, 405, or 429 per existing logic — never 404 "Function not
   found").
3. **Given** the PDS has redirected the user back to
   `/api/auth/callback?...`, **When** the callback request is made,
   **Then** the callback handler runs and a session is established
   (subsequent `/api/whoami` returns the user).
4. **Given** a signed-in user, **When** they POST `/api/auth/logout`,
   **Then** the logout handler runs and the session is revoked (no 404).
5. **Given** the user's PDS fetches
   `/.well-known/oauth-client-metadata.json`, **When** the request is made,
   **Then** the metadata document is returned (no 404, cacheable response
   preserved).
6. **Given** the fix has been deployed to staging and production,
   **When** an end user hits the same endpoints from those environments,
   **Then** the same handler-reaches-request guarantee holds (no
   environment-specific regression).

### Edge Cases

- The very first request after dev-server start MUST reach the handler
  (no "function compiling, try again" window where the user sees a 404).
- A request method other than `GET` to `/api/auth/login` MUST reach the
  handler and receive its current 405 response, not a 404.
- A request with a missing or empty `handle` parameter MUST reach the
  handler and receive its current 400 `handle_required` response, not a
  404.
- A request from a client over the per-IP rate limit MUST reach the
  rate-limit gate and receive a 429, not a 404.
- The fix MUST hold whether the dev server is started via `netlify dev`,
  `npm run dev`, or any other command documented as the supported local
  workflow in the repo. If a workflow is unsupported, that MUST be made
  explicit so contributors know not to use it.
- After a TypeScript or `netlify.toml` change to any auth-related file,
  the next request MUST reach the handler once the dev server has
  finished reloading. Stale-route caching that survives a reload is a
  regression.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `/api/auth/login` MUST reach the application's login
  handler on every request, in the local development environment AND in
  every deployed environment. A "Function not found" response from the
  platform layer is a failure of this requirement.
- **FR-002**: `/api/auth/callback` MUST reach the callback handler under
  the same conditions as FR-001.
- **FR-003**: `/api/auth/logout` MUST reach the logout handler under the
  same conditions as FR-001.
- **FR-004**: `/.well-known/oauth-client-metadata.json` MUST continue to
  be served with its existing cacheable response, since the user's PDS
  fetches it during the authorize flow.
- **FR-005**: The fix MUST work on the **first request** after a fresh
  dev-server start. A warm-up request MUST NOT be required for the auth
  endpoints to become reachable.
- **FR-006**: All existing handler behaviors MUST be preserved:
  per-IP rate limiting on login (10/min), handle validation, redirect to
  the PDS authorize URL with the configured atproto scopes, session
  cookie issuance on callback, atproto session revocation on logout, and
  the JSON cache-control defaults documented in `CLAUDE.md`.
- **FR-007**: The fix MUST NOT regress any other API endpoint that is
  currently reachable. In particular, every other route declared in
  `netlify.toml` MUST continue to reach its handler.
- **FR-008**: The fix MUST be durable across the common local-development
  workflows: dev-server restart, branch switch, dependency install,
  source-file edit-and-save. After any of these, the next request to an
  auth endpoint MUST reach the handler without manual intervention.
- **FR-009**: An automated test MUST exist that detects this class of
  defect (handler not reachable for `/api/auth/login`) so the bug cannot
  resurface a third time without CI noticing. The test MAY assert at the
  routing layer rather than running the full OAuth round-trip.
- **FR-010**: If the root cause is a developer-workflow gap rather than a
  code defect (for example, "you must run command X, not command Y"),
  the supported workflow MUST be documented in the repo root README and
  in `CLAUDE.md` so future contributors do not hit the same wall.

### Key Entities

- **Routing configuration**: The mapping from the public URL
  `/api/auth/login` to the function file that handles it. Today this
  lives in `netlify.toml` redirects pointing at flat-file functions
  under `netlify/functions/`. Whatever form this takes after the fix, it
  MUST be authoritative and not silently overridden by other config
  files.
- **Session**: The signed `drerings_auth` cookie carrying `id`, `did`,
  `handle`, and an issue timestamp. Never produced while login is
  unreachable, since the flow cannot reach the callback.
- **atproto OAuth state**: Transient state stored in Postgres during the
  authorize round-trip so the callback can verify the return matches the
  same login attempt. Never created while login is unreachable.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a clean checkout of the fix branch, a signed-out user
  is redirected to their PDS authorize URL on **100%** of requests to
  `/api/auth/login?handle=<valid-handle>`. The "Function not found"
  response is observed **0%** of the time, including on the first
  request after dev-server start.
- **SC-002**: A signed-out user can complete the full end-to-end sign-in
  flow (handle entry → PDS authorize → callback → `/api/whoami` returns
  the user) in a single sitting with **zero** intermediate 404 pages,
  in both local development and the deployed staging environment.
- **SC-003**: All three auth endpoints (login, callback, logout) AND the
  client-metadata document return their handler-defined responses (200,
  302, 400, 401, 405, 429 as appropriate) and never a generic
  platform-layer 404 in any tested scenario.
- **SC-004**: An automated test (or set of tests) covering the
  reachability of `/api/auth/login`, `/api/auth/callback`,
  `/api/auth/logout`, and `/.well-known/oauth-client-metadata.json`
  exists and passes on the fix branch. This test would have failed on
  the pre-fix branch (verifying it actually exercises the defect).
- **SC-005**: Existing automated tests for unrelated API endpoints
  (postcards, shares, billing, stamps, account, drawings, whoami)
  continue to pass — confirming no routing regression elsewhere.
- **SC-006**: A new contributor following only the README's
  "getting started" steps can sign in successfully on their first try,
  with no need to consult the team for an undocumented workaround.

## Assumptions

- The user's environment is up to date with `staging` (which already
  carries the 005 flat-file rename and redirect rules). The recurrence
  is therefore NOT explainable by "you didn't pull the previous fix" —
  the fix itself is incomplete or fragile, OR there is a developer
  workflow that bypasses it.
- The atproto OAuth client metadata, `SESSION_SECRET`, and PDS
  configuration are correct and unchanged by this fix. The bug is in
  request routing / function discovery, not in OAuth configuration.
- "Reaches the handler" is sufficient for this spec; the handler may
  then return any status code (302, 400, 401, 405, 429) per its
  existing behavior. This spec does NOT require any change to handler
  behavior, only that routing reach the handler reliably.
- The supported local development command(s) are whatever the README
  documents as the canonical way to run the app locally. If multiple
  commands exist (e.g., `npm run dev` and `netlify dev`) and only one
  routes auth correctly, the fix MUST either make all documented
  commands work OR explicitly narrow the documented set.

## Out of Scope

- Any change to the atproto OAuth flow itself (scopes, PDS selection,
  session cookie payload, HMAC signing, session TTL).
- Any change to handle validation logic, rate-limit thresholds, or
  session-store schema.
- Any UI/UX redesign of the sign-in flow. The bug is a 404 on a working
  flow; the fix restores reachability.
- Any change to other product features (postcards, shares, stamps,
  gifts, billing) beyond ensuring their endpoints remain reachable.
- Migrating off Netlify Functions or off `netlify.toml` redirects. The
  fix MUST work within the current platform choice unless the
  investigation reveals that platform choice is the proximate cause —
  in which case migration is escalated as a separate decision, not
  bundled into this fix.
