# Phase 0 Research: Fix Missing Database Connection in Local Dev

**Branch**: `008-fix-db-connection` | **Date**: 2026-05-27

This document resolves every NEEDS CLARIFICATION from the plan
Technical Context and records the rationale for the chosen approach.
No items remain unresolved.

## Decision 1 — What env var does `@netlify/database` actually read?

**Decision**: `NETLIFY_DB_URL` (single source of truth). The chosen
fix sets this one variable in the functions process's environment.

**Rationale**: `node_modules/@netlify/database/dist/main.js` line 22:

```js
const connectionString = env.get("NETLIFY_DB_URL");
if (!connectionString) {
  throw new MissingDatabaseConnectionError();
}
```

`getDatabase(options)` checks `options.connectionString` first and
falls back to `env.get("NETLIFY_DB_URL")`. Both paths throw
`MissingDatabaseConnectionError` if nothing is set. No other env var
name is supported — `NETLIFY_DATABASE_URL`, `DATABASE_URL`, etc. are
NOT read by this library. Reproducing the working production
behavior in dev therefore means making sure `NETLIFY_DB_URL` is in
`process.env` when `getDatabase()` runs.

**Alternatives considered**:
- Pass `connectionString` per call via `getDatabase({ connectionString })`.
  Rejected: violates FR-001 ("the function itself MUST NOT add
  fallback or recovery code") and FR-011 ("zero per-function code
  changes"). It would touch all 25+ call sites across
  `netlify/lib/{stamps,postcards,shares,rate-limit,session,
  auth-store,account,stamp-backfill}.ts`.
- Reach into `@netlify/database` internals or monkey-patch
  `getEnvironment()`. Rejected: undocumented, fragile across CLI
  upgrades, and unnecessary now that we know the env var name.

## Decision 2 — How should the functions process receive `NETLIFY_DB_URL` in dev?

**Decision**: Put `NETLIFY_DB_URL=<per-developer-postgres-url>` in
the repo's already-gitignored `.env` file. `netlify functions:serve`
auto-loads `.env` into the functions runtime's environment (it is
the Netlify CLI's standard local-env mechanism, same as for
`RESEND_API_KEY`, `AUTUMN_API_KEY`, `SESSION_SECRET`, and the other
secrets already living in this project's `.env`).

**Rationale**:
- `.env` is already in `.gitignore` (confirmed at the start of this
  work) — no risk of committing the connection string (FR-006,
  SC-006).
- The Netlify CLI loads `.env` automatically, so there is zero glue
  code required to make this work for the functions process. This is
  the lowest-disruption fix that satisfies every FR.
- Picking up a rotated value is exactly "edit `.env`, restart"
  (FR-007). No code changes, no rebuilds.
- Each developer's `.env` lives only on their machine, so two
  developers can point at different databases without committing
  personal strings (FR-005).
- The functions process is the only consumer (Vite never reads it).
  Vite does load `.env*` files by default for its own client code,
  but it only exposes variables prefixed with `VITE_` to the
  browser — `NETLIFY_DB_URL` is NOT `VITE_*`-prefixed and will not
  leak to the SPA bundle (FR-010, the "only the functions process
  consumes the connection string" constraint).

**Alternatives considered**:
- **Revert to `netlify dev` as the dev front door.** Rejected:
  spec 007 deliberately moved away from `netlify dev` to fix
  separate port/proxy/cookie issues. CLAUDE.md explicitly says "Don't
  re-introduce it." Constraint hard-baked into the plan's
  Technical Context.
- **`netlify env:import` from the linked site.** Rejected: requires
  the developer to be logged in to Netlify CLI AND have permission
  on the linked site. Excludes contributors who use a different
  Postgres backend (FR-005). Also pulls down ALL site env vars, not
  just `NETLIFY_DB_URL`, which collides with what already lives in
  `.env` and creates confusion about who wins.
- **A separate `.env.local` or `dev.env`.** Rejected: introduces a
  second secret file alongside the existing `.env`, increasing the
  surface area for "which file should I edit" mistakes. The existing
  `.env` already handles every other secret in this project; one
  more line in it is the simplest extension.
- **Hardcode a localhost Postgres URL into `package.json`.**
  Rejected: violates FR-005 (each developer's URL differs) and
  FR-006 (would be in a tracked file).

## Decision 3 — How do we make a missing/misconfigured connection fail loud and early?

**Decision**: Add a tiny `scripts/check-dev-env.mjs` preflight that
runs *before* `concurrently` kicks off the two long-running
processes. It reads `.env` (via `node --env-file=.env` — built into
Node 20.6+; we are on ≥20.19 per `engines.node`), checks
`process.env.NETLIFY_DB_URL`, and if missing prints a single
human-readable message and exits non-zero. `npm start` becomes:

```sh
node --env-file=.env scripts/check-dev-env.mjs && concurrently ...
```

The message tells the developer exactly which variable is missing,
where to put it, and where to find the value (README's "Develop"
section, which we update in Phase 1). No stack trace.

**Rationale**:
- Addresses FR-003 ("a single, clear, actionable message — at
  startup or on the first DB-backed request") by surfacing at
  startup, the more useful of the two options.
- Addresses SC-004 ("within 5 seconds of the first DB-backed
  request or at process start").
- Distinguishes from the "configured but unreachable" case
  (FR-004): the preflight only checks presence, not connectivity.
  If the variable is set but points at a dead host, the developer
  sees Postgres's own connection error from the functions runtime,
  which is visually and textually distinct from
  `MissingDatabaseConnectionError`. No extra code needed to make
  the two distinguishable.
- Single new file. Pure JS (no TS build step in the dev hot path).
  Uses Node's built-in `--env-file` flag — no new deps.

**Alternatives considered**:
- **Run the preflight inside the netlify functions process itself
  (e.g. as a wrapped handler).** Rejected: would still let the
  process bind to :9999 and report "ready" before failing, which is
  worse UX than failing before any process starts.
- **Add a runtime guard in `netlify/lib/http.ts` `json()` to
  intercept `MissingDatabaseConnectionError`.** Rejected: violates
  FR-001 (function-side fallback), would only catch the error after
  it has already crashed, and still requires changing handler code.
- **Skip the preflight and rely on `MissingDatabaseConnectionError`
  itself.** Rejected: that is exactly the status quo this spec is
  fixing (FR-003: "The message MUST NOT be a function stack trace").

## Decision 4 — Where do contributors learn this for the first time?

**Decision**: Update README `## Develop` section and the project
`CLAUDE.md` "Local development" section. The README change adds:
(a) a one-paragraph note that the functions process needs a
database connection in local dev, (b) the exact `NETLIFY_DB_URL=...`
line to add to `.env`, (c) a one-line pointer for where to obtain
the value (Netlify Database dashboard for teammates with site
access; local Postgres `postgres://...` URL for contributors who
prefer their own database). The `CLAUDE.md` change mirrors the same
information for AI assistants reading project context.

**Rationale**: README + CLAUDE.md are the two canonical contributor
context surfaces named explicitly in FR-009 and Assumptions. Adding
the info to either alone would miss the contract; adding it to both
guarantees SC-002 ("under 5 minutes of setup … without having to
read source code, commit history, or external Netlify docs").

**Alternatives considered**:
- **A standalone `docs/local-dev-database.md`.** Rejected: spec
  Assumptions explicitly bound the scope ("producing standalone
  setup tutorials is not [in scope]"). The README and `CLAUDE.md`
  are the documented home for this content.
- **Only update README, skip CLAUDE.md.** Rejected: FR-009 names
  both.

## Decision 5 — Confirming production is untouched

**Decision**: This spec adds zero code paths and zero env vars in
deployed runtimes. The mechanism in production is unchanged:
Netlify's Database integration injects `NETLIFY_DB_URL` into the
deployed Functions runtime automatically, exactly as it did before
spec 007. The preflight in `scripts/check-dev-env.mjs` runs only
from `npm start` (the dev entrypoint) — it is never invoked by the
Netlify build or runtime.

**Rationale**: FR-008 and SC-005 are satisfied by construction:
the only changed surfaces are `.env` (gitignored, never bundled),
`scripts/check-dev-env.mjs` (dev-only invocation), the `npm start`
script (dev-only invocation), and docs. None of those are part of
the deployed function bundle (`netlify.toml` `[functions]` points
at `netlify/functions`, which we do not touch).

**Alternatives considered**: None — the constraint is hard.

## Resolved status

Every NEEDS CLARIFICATION marker from the plan Technical Context is
resolved by one of the decisions above. No follow-up research is
needed before Phase 1.
