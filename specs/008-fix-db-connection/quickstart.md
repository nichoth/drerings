# Phase 1 Quickstart: Fix Missing Database Connection in Local Dev

**Branch**: `008-fix-db-connection` | **Date**: 2026-05-27
**Revision**: 2 — replaces the per-developer `.env`-line workflow
from revision 1 with the zero-config `@netlify/vite-plugin` workflow.

This is the developer-facing walk-through that the README and
`CLAUDE.md` updates will compress into a paragraph or two. It is
recorded here in full so reviewers can see exactly what the
fresh-contributor path looks like after this work merges.

## Prerequisites

- Node ≥20.19 (matches `engines.node` in `package.json`).
- `npm ci` already run in the repo root. (This installs
  `@netlify/vite-plugin`, which transitively brings in
  `@netlify/dev`, `@netlify/database-dev`, and PGlite.)

That is the full prerequisites list. The developer does NOT need:

- A Postgres install
- A Netlify account or login
- A connection string from anyone
- An `.env` line for the database
- A separate functions process running on `:9999`

## One-time setup

There is none. Skip this section.

## Running the stack

```sh
npm start
```

This runs `vite`. On startup the `@netlify/vite-plugin` (registered
in `vite.config.js`) does the following, in order, before the first
request is accepted:

1. Provisions a local PGlite Postgres instance under
   `.netlify/db/` (creating the directory on first run).
2. Sets `NETLIFY_DB_URL` and `NETLIFY_DB_DRIVER=server` in the
   in-process functions runtime's environment.
3. Mounts a Vite middleware that routes `/api/*` and
   `/.well-known/*` to the local Functions runtime.
4. Logs `Netlify Environment loaded` and `Middleware loaded.
   Emulating features: aiGateway, blobs, database, edgeFunctions,
   environmentVariables, functions, geolocation, headers, images,
   redirects, static.` via the Vite logger.

Vite then binds `:8888` and reports `ready`.

Browse to `http://127.0.0.1:8888` (NOT `localhost`, see CLAUDE.md
for the atproto loopback reason).

## Applying database migrations

The local PGlite database starts empty. Apply the project's
migrations to it once (and any time new migrations are added in
`netlify/database/migrations/`):

```sh
npx netlify db migrations apply
```

This walks `netlify/database/migrations/**/migration.sql` in order
against the PGlite instance. After this completes, all
DB-backed endpoints (sign-in, whoami, shares, postcards, billing)
have the schema they need.

If you want a clean slate, `npx netlify db reset` drops the local
DB and re-applies migrations. Alternatively, stop `npm start` and
`rm -rf .netlify/db/` — the next `npm start` re-provisions a fresh
PGlite instance, then re-run `npx netlify db migrations apply`.

## What success looks like

- Open the SPA, click "Sign in", enter your Bluesky handle.
- The browser's network panel shows
  `GET /api/auth-login?handle=...` returning **302** with a
  `Location` header pointing at your PDS.
- The browser redirects to the PDS consent screen.
- No "This function has crashed — `MissingDatabaseConnectionError`"
  page anywhere in the flow.
- Subsequent DB-backed calls (`/api/whoami`,
  `/api/shares-precheck`, `/api/postcards-send`, etc.) return
  normal business-logic responses, NOT 500s from a missing
  connection.

## Failure modes and how to read them

| What you see | What it means | How to fix |
|---|---|---|
| Vite startup log shows `Failed to start Netlify Database locally: <error>` | PGlite couldn't initialise. Most common causes: corrupted `.netlify/db/`, conflicting process holding the directory, or disk full. | `rm -rf .netlify/db/`, then `npm start` again. Re-run `npx netlify db migrations apply` after. |
| Stack starts, `Netlify Environment loaded` logged, but `/api/auth-login` returns 500 with `MissingDatabaseConnectionError` in the body | PGlite failed silently between startup and the first request, OR `@netlify/vite-plugin` is not actually registered in `vite.config.js`. | Confirm `vite.config.js` `plugins` array starts with `netlify()`. If it does, see the row above. |
| Stack starts, `/api/whoami` (or any other endpoint) returns 500 with `relation "users" does not exist` (or similar `relation … does not exist`) | DB IS reachable but migrations have not been applied. | `npx netlify db migrations apply`. |
| Old `MissingDatabaseConnectionError` page after a clean checkout | `npm ci` may have missed installing `@netlify/vite-plugin` (lockfile or registry issue), OR the `plugins` array in `vite.config.js` is wrong. | `rm -rf node_modules && npm ci` and re-check `vite.config.js`. |
| Port 8888 is already in use | Another Vite or another listener owns `:8888`. `strictPort: true` exits Vite loudly rather than silently picking a different port. | Stop the other process, or change `port` in `vite.config.js` AND `PUBLIC_URL` to match (otherwise atproto OAuth will redirect to the wrong origin). |

The "PGlite failed at startup" and "configured but missing schema"
rows above are deliberately distinguishable from each other and
from the historic `MissingDatabaseConnectionError` (FR-004): the
fix paths differ.

## Picking up a "rotated" connection

The local PGlite has no rotating credential — the value is
process-local and regenerated on every Vite start. There is nothing
to rotate.

If a teammate wants to wipe and restart from a known clean state:

```sh
npx netlify db reset
```

No code changes, no rebuild. (FR-007.)

## What this does NOT touch in production

- Deployed Netlify Functions still receive `NETLIFY_DB_URL` from
  Netlify's Database integration. Nothing about this change reaches
  the deployed bundle.
- No new env vars need to be set in the Netlify UI.
- No user-visible behavior changes for signed-in users in
  staging/production.
- `@netlify/vite-plugin` lives in `devDependencies` only — it is
  not bundled into deployed Functions output.
