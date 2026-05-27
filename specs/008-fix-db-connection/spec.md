# Feature Specification: Fix Missing Database Connection in Local Dev

**Feature Branch**: `008-fix-db-connection`
**Created**: 2026-05-27
**Status**: Draft
**Input**: User description: "Need to fix this DB backend error. MissingDatabaseConnectionError - The environment has not been configured to use Netlify Database. You must supply the connectionString option when calling getDatabase(). See https://ntl.fyi/database-environment for details. Occurs on GET /api/auth-login?handle=jarving.bsky.social with stack trace through getDatabase -> checkAndIncrement (netlify/lib/rate-limit.ts:32) -> Object.handler2 (netlify/functions/auth-login.ts)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer can complete OAuth sign-in in local dev without database crash (Priority: P1)

A developer runs the local dev stack, navigates to `/login`, enters a real Bluesky handle, and clicks "Sign in". The request to start OAuth (`/api/auth-login`) succeeds: the function code reaches its database-backed work (rate-limit bucket lookup, then any subsequent DB reads), and the developer is redirected to their PDS. The developer never sees a "This function has crashed — `MissingDatabaseConnectionError`" page.

**Why this priority**: OAuth login is the only authentication path in the app. The very first API call in the sign-in flow (`/api/auth-login`) hits the rate-limit bucket, which hits the database. Today that call crashes immediately with `MissingDatabaseConnectionError`, so no developer can sign in locally, which blocks every authenticated feature (sharing, postcards, billing, stamps, account). This is currently a hard block on all hand-driven dev work.

**Independent Test**: Start the dev stack, browse to the SPA, click "Sign in", enter a real Bluesky handle. Observe the network panel: the call to `/api/auth-login?handle=<handle>` returns a 302 (redirect to the PDS) — NOT a 500 with a `MissingDatabaseConnectionError` page. The browser then lands on the PDS consent screen.

**Acceptance Scenarios**:

1. **Given** the dev stack has been started by the documented start command and the developer has a database configured for dev, **When** the developer initiates OAuth sign-in with any valid handle, **Then** `/api/auth-login` returns a 302 redirect to the PDS (no 500, no `MissingDatabaseConnectionError`).
2. **Given** the dev stack is running, **When** the developer issues any API request that exercises the database (e.g. `/api/whoami`, `/api/postcards-send`, `/api/shares-precheck`), **Then** the function reaches a normal success or business-logic-driven error response — it does NOT crash with `MissingDatabaseConnectionError`.
3. **Given** a fresh checkout where the developer has NOT yet configured a database for dev, **When** the developer runs the documented start command, **Then** the developer is told — at start time or on the first DB-backed request — exactly what is missing and how to provide it, in a single clear message (not via a generic crash page deep in a request).

---

### User Story 2 - The dev stack documents its database requirement up front (Priority: P2)

A new contributor cloning the repo and following the README to start local dev is told, before they hit a runtime crash, that the functions process needs a database connection and how to provide one. The information lives where the start command does (README and/or `CLAUDE.md`), not buried in commit history or in an external Netlify docs page.

**Why this priority**: Every authenticated path needs the database. Without up-front guidance, every new contributor reproduces the same `MissingDatabaseConnectionError` and has to re-derive the fix. This is high value for onboarding but secondary to making the existing developer's stack work today.

**Independent Test**: Read the project's contributor-facing docs (README and `CLAUDE.md`) end-to-end. Verify they describe (a) that the functions process needs a database connection in local dev, (b) what environment variable(s) or configuration must be present, and (c) how a contributor sets that up from a fresh checkout.

**Acceptance Scenarios**:

1. **Given** a new contributor reads the README's "Local development" section, **When** they reach the start instructions, **Then** the database-connection requirement is documented in or directly adjacent to the start instructions, with a pointer to how to satisfy it.
2. **Given** the documented setup steps are followed from a fresh checkout, **When** the developer runs the start command, **Then** the dev stack starts cleanly and `/api/auth-login` works on the first try.

---

### User Story 3 - Production deployment is unaffected (Priority: P3)

A maintainer deploying this change to staging or production observes no behavioral change in deployed environments. The Netlify-managed database connection that already works in deployed runtimes continues to work, with no new configuration burden, no new env vars to set in the Netlify UI, and no migration to a different connection mechanism in production.

**Why this priority**: The error is dev-only — deployed Netlify Functions get the Netlify Database connection injected automatically. The fix targets local dev only. This story exists to make the "do not regress production" intent explicit.

**Independent Test**: Deploy the change to a preview environment. Confirm that an authenticated flow (sign-in, then any DB-backed endpoint) works on the deployed origin exactly as it did before this change, with no new environment variables needing to be set in the Netlify UI.

**Acceptance Scenarios**:

1. **Given** the change is deployed to a preview or production environment, **When** a real user signs in via atproto OAuth and performs any DB-backed action, **Then** the experience is indistinguishable from the pre-change baseline.
2. **Given** the deployed Netlify site configuration (env vars, integrations, build settings), **When** this change is merged, **Then** no additional manual configuration in the Netlify UI is required to keep deployed environments working.

---

### Edge Cases

- The developer has no database provisioned at all (e.g. brand-new contributor, no Netlify project linked, no local Postgres). The dev stack MUST surface this as an actionable message at startup or on the first DB-backed request, not as a stack trace from inside a function handler.
- The developer has a connection string configured but it points at an unreachable host, wrong credentials, or a database missing required migrations. The error surfaced to the developer MUST distinguish "no connection configured" from "configured but the connection or query failed" — these have different fixes.
- Two developers on the same team use different database backends in dev (e.g. one uses a Netlify-hosted dev branch, another uses a local Postgres). The configured mechanism MUST allow each to point the functions process at their own database without committing personal connection strings.
- A developer rotates or replaces their database connection string. Picking up the new value MUST NOT require code changes — only restarting the functions process (at worst).
- A connection string contains a password with shell-special characters. The configuration mechanism MUST tolerate this without manual escaping mistakes corrupting the value.
- The functions process is started without the connection-providing wrapper or env file the project expects. The failure MUST be loud and immediate (at process start), not deferred to the first DB-backed request half a minute later.
- A connection string is accidentally committed to the repo or to a build artifact. The configuration mechanism MUST default to a path that keeps connection strings out of git (e.g. ignored env file, secret store, linked project).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: In local development, every serverless function that calls `getDatabase()` MUST receive a usable database connection without the function itself adding fallback or recovery code — the platform/dev-stack layer is responsible for supplying the connection.
- **FR-002**: Starting the dev stack with the documented start command on a correctly configured developer machine MUST allow `/api/auth-login` (the canonical first DB-backed call in the OAuth flow) to complete its database work and return its normal `302` redirect to the PDS. It MUST NOT crash with `MissingDatabaseConnectionError`.
- **FR-003**: Starting the dev stack on a machine where no database connection is configured MUST surface a single, clear, actionable message — at startup or on the first DB-backed request — that names what is missing and where to set it. The message MUST NOT be a function stack trace.
- **FR-004**: A configuration error related to the database connection in local dev MUST distinguish at least these two cases for the developer: (a) no connection configured at all, (b) connection configured but the database is unreachable or rejected the connection. These cases have different fixes and MUST NOT be presented identically.
- **FR-005**: The dev-time connection mechanism MUST allow each contributor to point the local functions process at their own database (Netlify-hosted branch, local Postgres, or other) without committing personal connection strings to the repo.
- **FR-006**: The dev-time connection mechanism MUST NOT cause connection strings, credentials, or other secrets to land in committed files, in build output, or in any artifact published by the project.
- **FR-007**: Picking up a changed dev-time connection string MUST require, at most, restarting the functions process — never a code change, a rebuild, or editing tracked files.
- **FR-008**: The dev-time fix MUST be a dev-only change. Deployed environments (production, preview, branch) MUST continue to receive their database connection through whatever mechanism they use today, with no new environment variables to set in the Netlify UI and no behavioral change observable to end users.
- **FR-009**: The README and `CLAUDE.md` "Local development" guidance MUST be updated so a fresh contributor reading them, in order, learns that the functions process needs a database connection in local dev and how to satisfy that requirement, before they hit a runtime crash.
- **FR-010**: The dev-time fix MUST NOT relax existing security posture: it MUST NOT cause secrets to be logged, written to disk in tracked locations, or exposed to the browser. The functions process MUST remain the only consumer of the database connection string.
- **FR-011**: The fix MUST cover every existing function that uses `getDatabase()`, not just `/api/auth-login`. A passing fix for the canonical case implies the same fix path works for `/api/whoami`, `/api/postcards-send`, `/api/shares-precheck`, `/api/shares-confirm`, the billing checkout endpoints, the Resend webhook, and any other function that touches the database — without per-function code changes.

### Key Entities

- **Database Connection (local dev)**: The credential and address the local functions process uses to reach a Postgres database for development. Per-developer, never committed, must be present before any DB-backed request can succeed.
- **Local Dev Stack**: The collection of processes the developer runs to exercise the app locally (SPA dev server + functions runtime). The functions runtime is the only process that needs the database connection.
- **Deployed Runtime**: The Netlify-managed environment where functions run in production / preview / branch. Already receives the database connection through the platform; this spec MUST NOT change that path.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a developer machine with a correctly configured dev database, starting the dev stack and exercising the OAuth sign-in flow results in zero `MissingDatabaseConnectionError` responses across 10 consecutive sign-in attempts (currently: 100% of attempts crash).
- **SC-002**: A new contributor following the README from a fresh checkout reaches a working `/api/auth-login` (the call returns its normal `302`) on the first attempt in under 5 minutes of setup — without having to read source code, commit history, or external Netlify docs to figure out the database configuration step.
- **SC-003**: Across every function in the project that calls `getDatabase()`, zero of them require per-function code changes to receive a working connection in local dev — the fix lives in shared dev-stack configuration, not in each handler.
- **SC-004**: When a developer starts the dev stack on a machine missing the database configuration, they receive a message that names the missing piece and how to set it within 5 seconds of the first DB-backed request (or at process start), and they can resolve the issue without reading a stack trace.
- **SC-005**: Deployed environments (production, preview, branch) show zero behavioral change after this work merges: no new environment variables required in the Netlify UI, no change to user-visible behavior for any authenticated flow, no regression in any deployed health check.
- **SC-006**: Zero secrets (connection strings, credentials, tokens) appear in any tracked file or build artifact as a result of this change.

## Assumptions

- The deployed Netlify Functions runtime already receives a working `NETLIFY_DB_URL` via the Netlify platform's database integration. The bug is specific to the local dev configuration introduced by the 007 split-dev-ports work, which moved away from `netlify dev` (which auto-injects linked-site env vars) to a `netlify functions:serve` invocation that does not.
- Contributors must end up with a Postgres database the functions process can reach. Provisioning that database for new contributors is in scope only to the extent that the chosen mechanism can do it itself (e.g. a dev-stack component that spins up a per-developer local Postgres). It is out of scope to require each contributor to obtain credentials for a hosted Postgres out of band.
- Vite remains the listener on `:8888` and the SPA origin. The browser must hit `127.0.0.1:8888` (not `localhost:8888`) so atproto OAuth's loopback client and cookie scoping continue to work. The fix MUST preserve this. The fix MAY collapse the two-process dev layout introduced by spec 007 if it does so without reintroducing `netlify dev`'s outer-proxy architecture — i.e. Vite stays the actual HTTP listener.
- Whatever mechanism stores or provides the local connection string MUST keep it out of tracked files and out of any build artifact (FR-006, FR-010, SC-006). A gitignored `.env`, a gitignored auto-provisioned data directory, or an entirely process-local value are all acceptable; a committed default URL is not.
- The README and `CLAUDE.md` "Local development" sections are the canonical places contributors look first for dev-environment setup. Updating them is in scope; producing standalone setup tutorials is not.
