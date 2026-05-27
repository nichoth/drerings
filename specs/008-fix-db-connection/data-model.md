# Phase 1 Data Model: Fix Missing Database Connection in Local Dev

**Branch**: `008-fix-db-connection` | **Date**: 2026-05-27

## No domain entities

This feature has no domain data model. It does not introduce, modify,
or remove any database tables, columns, indexes, constraints, or
materialized views. It does not introduce, modify, or remove any
in-memory entities, types, or interfaces in application code.

The Postgres schema referenced by `getDatabase()` is unchanged. The
migrations in `netlify/database/migrations/` are unchanged. No new
migration is created by this work.

## Configuration "entity" (recorded for completeness)

The feature spec lists three "Key Entities":

- **Database Connection (local dev)** — modeled as a single
  per-developer environment variable, `NETLIFY_DB_URL`, supplied via
  the project's already-gitignored `.env` file. Per-developer, never
  committed, MUST be present before any DB-backed request can
  succeed.
- **Local Dev Stack** — the two-process layout (Vite on `:8888`,
  `netlify functions:serve` on `:9999`) defined by spec 007. The
  functions process is the only consumer of `NETLIFY_DB_URL`. Vite
  does not read it (Vite only exposes `VITE_`-prefixed variables to
  the SPA bundle; this variable is not so prefixed and will not leak
  to the browser).
- **Deployed Runtime** — the Netlify-managed Functions runtime in
  production/preview/branch. Already receives `NETLIFY_DB_URL` from
  Netlify's Database integration. UNCHANGED by this work.

These are configuration concerns, not data-model entities, and they
do not produce schemas, types, or migration artifacts.

## Validation rules

The single configuration variable has one validation rule, enforced
by the new `scripts/check-dev-env.mjs` preflight:

- `NETLIFY_DB_URL` MUST be present (non-empty string) in the
  functions process's environment when `npm start` is invoked.

The preflight does NOT validate the URL format, the host's
reachability, or the database's schema state. Those are deliberately
left to surface from Postgres / `@netlify/database` at the moment
of first use, so that "configured but unreachable" and "configured
but rejected" remain visually and textually distinct from "not
configured" (FR-004).

## State transitions

None. There is no state machine.
