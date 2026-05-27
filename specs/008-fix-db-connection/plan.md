# Implementation Plan: Fix Missing Database Connection in Local Dev

**Branch**: `008-fix-db-connection` | **Date**: 2026-05-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-fix-db-connection/spec.md`

## Summary

`/api/auth-login` (and every other function that calls `getDatabase()`)
crashes in local dev with `MissingDatabaseConnectionError`. The 007
split-dev-ports work replaced `netlify dev` (which auto-injects the
linked site's env vars, including the database URL) with a bare
`netlify functions:serve` invocation, so the functions process now
starts without `NETLIFY_DB_URL` in its environment.

`@netlify/database`'s `getDatabase()` reads exactly one env var:
`NETLIFY_DB_URL` (see `node_modules/@netlify/database/dist/main.js`).
The fix is therefore a dev-stack-config change, not a code change:
provide that one variable to the functions process in local dev via
the already-gitignored `.env` file (which `netlify functions:serve`
loads automatically), add a single preflight check before
`concurrently` starts so a missing variable fails loud and at startup
rather than as a stack trace mid-request, and document the requirement
in the two canonical places contributors look first (README "Develop"
section and project `CLAUDE.md`). Production is untouched: deployed
Netlify Functions still receive the database URL from the platform's
Netlify Database integration.

## Technical Context

**Language/Version**: TypeScript 5.8 (ES2022, ESM), Node ≥20.19
**Primary Dependencies**: `@netlify/database` ^1.0.0,
`@netlify/functions` ^4.1.8, `netlify-cli` ^26.0.2,
`concurrently` ^9.0.1, Vite 7
**Storage**: Postgres (Netlify DB in prod; per-developer Postgres in
local dev, configured via `NETLIFY_DB_URL`)
**Testing**: Vitest 4 (`npm run test:e2e`), tapout browser bundle
(`npm test`), ESLint (`npm run lint`); no new code paths to unit-test —
verification is "start the stack and observe behavior"
**Target Platform**: Local dev on macOS/Linux; deployed Netlify
Functions runtime (Node 25 per `netlify.toml`)
**Project Type**: Single-project web app (Preact SPA + Netlify
Functions backend), per existing layout
**Performance Goals**: N/A (dev-stack configuration change)
**Constraints**:
- MUST NOT reintroduce `netlify dev` as the dev front door (spec
  007 deliberately moved away from it).
- MUST NOT add per-function fallback code (FR-001, FR-011).
- MUST NOT cause connection strings to land in tracked files
  (FR-006, FR-010, SC-006).
- MUST NOT change anything in deployed environments (FR-008, SC-005)
  — no new Netlify UI env vars, no behavioral diff.
- MUST NOT require code changes when a developer rotates their
  connection string (FR-007).
**Scale/Scope**: Affects one `.env`, the `npm start` script, one new
preflight script in `scripts/`, the README "Develop" section, and
`CLAUDE.md` "Local development" guidance.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The repository constitution at `.specify/memory/constitution.md` is
the unfilled template (all placeholders, no ratified principles). No
gates to evaluate. Recording this as a non-blocking note rather than
a violation — there is nothing to violate.

Post-design re-check: still no constitution principles to evaluate;
no Complexity Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/008-fix-db-connection/
├── plan.md              # This file
├── research.md          # Phase 0 — approach decision + alternatives
├── data-model.md        # Phase 1 — N/A (no entities), recorded for completeness
├── quickstart.md        # Phase 1 — developer-facing setup walk-through
├── contracts/
│   └── README.md        # Phase 1 — no external contracts changed, recorded
└── tasks.md             # Created later by /speckit.tasks (NOT this command)
```

### Source Code (repository root)

This feature is a dev-stack-config + docs change. No new source
modules; existing layout is authoritative:

```text
.env                        # gitignored; add NETLIFY_DB_URL line here
.gitignore                  # already ignores .env (no change)
package.json                # update "start" to run preflight first
scripts/
└── check-dev-env.mjs       # new: preflight (fail-loud at startup if
                            # NETLIFY_DB_URL is missing)
README.md                   # update "Develop" section (FR-009, SC-002)
CLAUDE.md                   # update "Local development" guidance (FR-009)
netlify/
├── functions/              # unchanged
└── lib/                    # unchanged — NO per-function fallback code
                            # (FR-001, FR-011)
```

**Structure Decision**: Single-project web app, existing layout.
The change touches dev-stack glue (`.env`, `package.json` start
script, one new `scripts/check-dev-env.mjs` preflight) and docs
(README, CLAUDE.md). Nothing under `netlify/functions/` or
`netlify/lib/` is modified — that is a deliberate constraint from
FR-001 and FR-011: the fix is a platform-layer change, not a
per-handler change.

## Complexity Tracking

No constitution principles to violate. No deviations to justify.
