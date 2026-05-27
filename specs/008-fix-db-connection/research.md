# Phase 0 Research: Fix Missing Database Connection in Local Dev

**Branch**: `008-fix-db-connection` | **Date**: 2026-05-27
**Revision**: 2 — replaced the preflight + `.env` approach (revision 1)
with `@netlify/vite-plugin` after prototyping showed it eliminates the
configuration step entirely.

This document resolves every NEEDS CLARIFICATION from the plan
Technical Context and records the rationale for the chosen approach.
No items remain unresolved.

## Decision 1 — What env var does `@netlify/database` actually read?

**Decision**: `NETLIFY_DB_URL` (single source of truth). Whatever
mechanism we choose for the dev fix must end up with this variable
in the functions runtime's environment.

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
NOT read by this library.

**Alternatives considered**:
- Pass `connectionString` per call via `getDatabase({ connectionString })`.
  Rejected: violates FR-001 ("the function itself MUST NOT add
  fallback or recovery code") and FR-011 ("zero per-function code
  changes").
- Reach into `@netlify/database` internals or monkey-patch
  `getEnvironment()`. Rejected: undocumented, fragile.

## Decision 2 — How should the functions process receive `NETLIFY_DB_URL` in dev?

**Decision**: Adopt `@netlify/vite-plugin`. The plugin emulates the
Netlify platform inside the Vite dev server: it intercepts requests
via Vite middleware, routes `/api/*` and `/.well-known/*` to the
local Functions runtime, AND — via its bundled `@netlify/dev` +
`@netlify/database-dev` (PGlite) integration — provisions a local
Postgres in `.netlify/db/` and injects `NETLIFY_DB_URL` (plus
`NETLIFY_DB_DRIVER=server`) into the functions runtime automatically.

Concretely:

1. `npm install @netlify/vite-plugin` (devDependency).
2. `vite.config.js` registers `netlify()` first in the plugins array.
3. `package.json`'s `start` script becomes just `"vite"` (was
   `concurrently --kill-others "npx netlify functions:serve --port=9999" "npx vite"`).
4. No application code, no env file edits, no preflight script
   required.

**Rationale**:

- The plugin's `@netlify/dev` orchestrator does exactly what the
  deployed Netlify platform does: starts a local Postgres (PGlite),
  sets `runtime.env.NETLIFY_DB_URL` to its connection string, and
  exposes the functions handler via Vite middleware. Documented at
  `node_modules/@netlify/dev/dist/main.js:546-558`.
- A fresh contributor's setup is now `npm ci && npm start` —
  everything between is auto-provisioned. SC-002 ("under 5 minutes,
  no source-code reading, no external Netlify docs") drops to
  effectively zero seconds of dev-environment configuration.
- Picking up a rotated connection string is a non-event (FR-007):
  there is no string to rotate. The local DB lives in `.netlify/db/`
  (gitignored) and is per-developer by construction.
- No connection string ever lives in any tracked or untracked
  developer file (FR-006, SC-006): the PGlite directory is the only
  artifact, and it is opaque binary state, not a secret.
- Production is untouched (FR-008, SC-005): deployed Netlify
  Functions still receive `NETLIFY_DB_URL` from the Netlify
  Database integration. The plugin is a *dev-only* devDependency
  that doesn't ship to the deployed bundle (see Decision 5).
- FR-011 ("zero per-function code changes") is satisfied trivially:
  the fix is one line in `vite.config.js` and one line in
  `package.json`. Nothing under `netlify/functions/` or
  `netlify/lib/` is touched.

**Alternatives considered**:

- **Add `NETLIFY_DB_URL=...` to `.env` and a preflight script**
  (revision 1's approach). Rejected: requires each developer to
  obtain a Postgres URL out of band (Netlify dashboard, shared
  teammate URL, or local Postgres setup) before they can start. The
  vite-plugin approach removes that step entirely.
- **Revert to `netlify dev` as the dev front door.** Rejected:
  spec 007 moved away from `netlify dev` to fix port/proxy/cookie
  problems specific to its `[dev]`-block-driven proxy. The vite-plugin
  is a *different* mechanism — it embeds the same functionality
  *inside* Vite rather than running an outer proxy in front of Vite
  — so the constraints that motivated spec 007's move are not
  reintroduced. Specifically: Vite remains the listener on `:8888`,
  the SPA origin is still under direct Vite control, and cookies on
  `127.0.0.1:8888` work without any cross-origin hop.
- **`netlify env:import` from the linked site.** Rejected: requires
  CLI login + site permission, pulls all site env vars, and still
  requires a real DB URL that someone has to provision somewhere.
- **A separate `.env.local` or `dev.env`.** Rejected: same problem as
  the rejected `.env` approach — the developer still has to obtain a
  URL.
- **Hardcode a localhost Postgres URL.** Rejected: violates FR-005
  (each developer's URL differs) and presupposes a Postgres install.

## Decision 3 — How does a missing/misconfigured connection now surface?

**Decision**: The plugin's `@netlify/dev` starts PGlite at process
start and *logs* its outcome to the Vite logger. On success, the
plugin prints `Netlify Environment loaded` and lists enabled features
(including `database`). On startup failure, the plugin logs
`Failed to start Netlify Database locally: …` (see
`node_modules/@netlify/dev/dist/main.js:559-562`) before Vite's
middleware accepts the first request. That message names the
component and the underlying error.

If the DB fails to provision AND the functions runtime is still
started, the first request to a DB-backed endpoint surfaces
`MissingDatabaseConnectionError` from `@netlify/database` itself —
identical wording to the bug we are fixing. The plugin's startup log
is the early-warning signal; the `MissingDatabaseConnectionError`
fallback covers the case where the developer ignored the startup log.

**Rationale**:
- FR-003 ("a single, clear, actionable message — at startup or on
  the first DB-backed request") is satisfied by the plugin's startup
  logger.
- FR-004's "not configured" vs "configured but unreachable" split
  is preserved because the two failure modes have visibly different
  shapes: "configured but unreachable" surfaces from Postgres
  (`ECONNREFUSED`, `password authentication failed`, etc., reaching
  the developer through the function's normal error response). "Not
  configured" is now structurally hard to reach — it requires
  `@netlify/database-dev` to fail to provision the local PGlite,
  which is an environmental problem (disk full, corrupted
  `.netlify/db/`) and logs distinctly.

**Alternatives considered**:
- A separate preflight script (`scripts/check-dev-env.mjs`,
  revision 1). Rejected because nothing left for it to check —
  there is no longer a developer-supplied env var to verify.
- Wrap the functions runtime to intercept
  `MissingDatabaseConnectionError`. Rejected: violates FR-001 (no
  function-side fallback code).

## Decision 4 — Where do contributors learn this for the first time?

**Decision**: Update README's "Develop" section and the project
`CLAUDE.md` "Local development" section. The change describes:
(a) `npm start` runs a single Vite process, (b) `@netlify/vite-plugin`
emulates Functions, Edge Functions, Headers, Redirects, Blobs, and
the local Netlify Database, (c) the local DB lives in `.netlify/db/`
(gitignored, per-developer), (d) migrations are applied to it via
`npx netlify db migrations apply`, and (e) production paths are
unaffected.

The two existing notes about the two-process layout — the
`server.proxy` description in README and the
"`server.proxy` … forwards `/api/*` … to `:9999`" paragraph in
CLAUDE.md — are removed, because the proxy is no longer wired up.
The 127.0.0.1-not-localhost note for atproto OAuth is preserved.

**Rationale**: README + CLAUDE.md are the canonical contributor
context surfaces named explicitly in FR-009 and Assumptions. Their
old text describes a two-process architecture that no longer
exists — leaving it would mislead every reader.

**Alternatives considered**:
- A standalone `docs/local-dev-database.md`. Rejected: same as
  revision 1 — the spec Assumptions explicitly bound scope to README
  and CLAUDE.md.

## Decision 5 — Confirming production is untouched

**Decision**: `@netlify/vite-plugin` lives in `devDependencies`
only. It is never required at runtime by anything under
`netlify/functions/**` or `netlify/lib/**`. The deployed Functions
bundle (built by Netlify's bundler from `netlify/functions/`) does
not include it. Deployed runtimes continue to receive
`NETLIFY_DB_URL` from Netlify's Database integration exactly as
before.

The Vite build (`npm run build`) emits client bundles to `public/`
and is unaffected by the plugin's dev-only `configureServer` hook
(the plugin returns no production transformer; see
`node_modules/@netlify/vite-plugin/dist/main.js:97-167`).

**Rationale**: FR-008 and SC-005 are satisfied by construction. The
only changed surfaces are:
- `package.json` (one new devDep + new `start` value)
- `package-lock.json` (lockfile churn)
- `vite.config.js` (one plugin registration + removal of the
  now-dead `:9999` proxy block)
- `README.md`, `CLAUDE.md` (docs)
- `specs/008-fix-db-connection/**` (specs)

None of those are part of the deployed function bundle.

**Alternatives considered**: None — the constraint is hard.

## Decision 6 — What about the spec-007 two-process layout?

**Decision**: This change supersedes the two-process layout from
spec 007 *for local dev only*. Production / preview / branch
environments were never affected by spec 007 (its scope was the
dev front door); they remain untouched here.

The spec-007 constraints that still apply:
- Vite owns `:8888`. Browser must hit `127.0.0.1:8888`, not
  `localhost:8888` (atproto OAuth loopback + cookie scoping).
- `strictPort: true` — Vite exits loudly if `:8888` is taken.

The spec-007 constraints that no longer apply:
- `netlify functions:serve` on `:9999` (process removed).
- `concurrently --kill-others` wrapper (removed; Vite is the only
  process).
- `vite.config.js` `server.proxy` table mirroring `netlify.toml`
  redirects (removed; the plugin's middleware handles routing
  directly via its emulated redirects engine, which reads
  `netlify.toml` automatically).
- CLAUDE.md's "Don't re-introduce `netlify dev`" rule no longer
  applies. We are not re-introducing `netlify dev` (which is its
  own CLI command with its own outer-proxy architecture); we are
  embedding the equivalent functionality *inside* Vite via a Vite
  plugin. The two are mechanically distinct, and the constraints
  that motivated avoiding `netlify dev` (proxy/cookie/port
  ergonomics) do not apply to the in-Vite-middleware approach.

**Rationale**: The spec-007 architecture was correct for the
problem it was solving at the time (the `netlify dev` outer proxy
mishandling redirects to `127.0.0.1`). The `@netlify/vite-plugin`
approach didn't exist (or wasn't on the team's radar) when 007 was
designed. With it available, the simpler one-process layout
satisfies every spec-007 user-facing requirement *and* eliminates
the configuration burden that motivated spec 008.

## Resolved status

Every NEEDS CLARIFICATION marker from the plan Technical Context is
resolved by one of the decisions above. No follow-up research is
needed before Phase 1.
