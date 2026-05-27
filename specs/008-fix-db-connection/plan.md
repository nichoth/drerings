# Implementation Plan: Fix Missing Database Connection in Local Dev

**Branch**: `008-fix-db-connection` | **Date**: 2026-05-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-fix-db-connection/spec.md`
**Revision**: 2 — replaces the preflight + `.env` approach
documented in revision 1. See [research.md](./research.md) Decision 2
for the rationale.

## Summary

`/api/auth-login` (and every other function that calls `getDatabase()`)
crashes in local dev with `MissingDatabaseConnectionError`. The 007
split-dev-ports work replaced `netlify dev` (which auto-injects the
linked site's env vars, including the database URL) with a bare
`netlify functions:serve` invocation, so the functions process now
starts without `NETLIFY_DB_URL` in its environment.

The fix is to adopt [`@netlify/vite-plugin`](https://www.npmjs.com/package/@netlify/vite-plugin)
as the local dev runtime. The plugin emulates the Netlify platform
inside the Vite dev server: it intercepts requests via Vite middleware
to route `/api/*` and `/.well-known/*` through the local Functions
runtime, AND — via its bundled `@netlify/dev` integration — boots a
local Netlify Database (PGlite) in `.netlify/db/` and injects
`NETLIFY_DB_URL` (plus `NETLIFY_DB_DRIVER=server`) into the functions
runtime automatically.

`npm start` becomes a single command: `vite`. The two-process
`concurrently` wrapper, the dead `:9999` port, and the
`vite.config.js` `server.proxy` table that mirrored
`netlify.toml`'s redirects are all retired in local dev. Production
is untouched: deployed Netlify Functions still receive the database
URL from the platform's Netlify Database integration.

## Technical Context

**Language/Version**: TypeScript 5.8 (ES2022, ESM), Node ≥20.19
**Primary Dependencies**: `@netlify/database` ^1.0.0,
`@netlify/functions` ^4.1.8, `@netlify/vite-plugin` ^2.12.6 (new
devDep), Vite 7
**Storage**: Postgres. Deployed: Netlify Database integration. Local
dev: PGlite (per-developer, provisioned in `.netlify/db/` by
`@netlify/database-dev`, transitively via `@netlify/vite-plugin`).
**Testing**: Vitest 4 (`npm run test:e2e`), tapout browser bundle
(`npm test`), ESLint (`npm run lint`); no new code paths to unit-test —
verification is "start the stack and observe behavior"
**Target Platform**: Local dev on macOS/Linux; deployed Netlify
Functions runtime (Node 25 per `netlify.toml`)
**Project Type**: Single-project web app (Preact SPA + Netlify
Functions backend), per existing layout
**Performance Goals**: N/A (dev-stack configuration change)
**Constraints**:
- MUST NOT add per-function fallback code (FR-001, FR-011).
- MUST NOT cause connection strings to land in tracked files
  (FR-006, FR-010, SC-006).
- MUST NOT change anything in deployed environments (FR-008, SC-005)
  — no new Netlify UI env vars, no behavioral diff.
- MUST NOT require code changes when a developer's local DB state
  changes (FR-007). With the plugin's PGlite, this is satisfied
  trivially: the database is per-process and rebuilt at startup if
  the directory is removed.
- Vite remains the listener on `:8888`. Browser must hit
  `127.0.0.1:8888`, not `localhost:8888` (atproto OAuth loopback).
**Scale/Scope**: Two-line addition to `vite.config.js`, one-line
edit to `package.json` `start`, removal of the dead `server.proxy`
block, one new devDependency, and doc updates in README and CLAUDE.md.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The repository constitution at `.specify/memory/constitution.md` is
the unfilled template (all placeholders, no ratified principles). No
gates to evaluate.

Post-design re-check: still no constitution principles to evaluate;
no Complexity Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/008-fix-db-connection/
├── plan.md              # This file (revision 2)
├── research.md          # Phase 0 — vite-plugin decision + alternatives
├── data-model.md        # Phase 1 — N/A (no entities)
├── quickstart.md        # Phase 1 — developer-facing setup walk-through
├── contracts/
│   └── README.md        # Phase 1 — no external contracts changed
└── tasks.md             # Created by /speckit.tasks
```

### Source Code (repository root)

This feature is a dev-stack-config + docs change. No new source
modules; existing layout is authoritative:

```text
package.json                # `start` becomes `"vite"`; add
                            # @netlify/vite-plugin to devDependencies
package-lock.json           # lockfile churn from npm install
vite.config.js              # register `netlify()` plugin; remove
                            # dead server.proxy block targeting :9999
.netlify/db/                # auto-provisioned PGlite directory
                            # (gitignored; per-developer)
README.md                   # rewrite "Develop" section (FR-009, SC-002)
CLAUDE.md                   # rewrite "Local development" section (FR-009)
netlify/
├── functions/              # unchanged
└── lib/                    # unchanged — NO per-function fallback code
                            # (FR-001, FR-011)
```

**Structure Decision**: Single-project web app, existing layout.
The change is contained to the dev front door (`vite.config.js`,
`package.json` `start`) and to the docs that describe it (README,
CLAUDE.md). Nothing under `netlify/functions/` or `netlify/lib/`
is modified — that is a deliberate constraint from FR-001 and
FR-011: the fix is a platform-layer change, not a per-handler
change.

## Complexity Tracking

No constitution principles to violate. No deviations to justify.

The architectural change here — collapsing the spec-007 two-process
layout into a single `vite` process — could appear to violate
spec 007's "don't re-introduce a unified dev front door" guidance.
It does not: spec 007 was guarding against `netlify dev`'s outer
proxy specifically, which mishandled atproto OAuth's `127.0.0.1`
loopback. `@netlify/vite-plugin` embeds the equivalent functionality
*inside* Vite via a `configureServer` hook, so Vite remains the
listener on `:8888` and the OAuth loopback semantics are preserved.
See research.md Decision 6 for the full reasoning.
