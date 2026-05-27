# Phase 1 Quickstart: Fix Missing Database Connection in Local Dev

**Branch**: `008-fix-db-connection` | **Date**: 2026-05-27

This is the developer-facing walk-through that the README and
`CLAUDE.md` updates will compress into a paragraph or two. It is
recorded here in full so reviewers can see exactly what the
fresh-contributor path looks like after this work merges.

## Prerequisites

- Node ≥20.19 (matches `engines.node` in `package.json`).
- `npm ci` already run in the repo root.
- Access to a Postgres database for development. Options:
  - **Recommended**: a connection string from the project's Netlify
    Database dashboard (ask a maintainer for the dev/staging URL).
  - **Alternative**: a local Postgres instance running the
    project's migrations (apply `netlify/database/migrations/*.sql`
    in order against an empty database).
  - **Alternative**: a teammate's shared dev URL.

The connection string is per-developer. Two contributors can use
different databases without coordinating, as long as each puts their
own value in their own `.env`.

## One-time setup

1. Copy your Postgres connection string. It looks like
   `postgres://USER:PASSWORD@HOST:PORT/DBNAME` or, for Neon,
   `postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require`.

2. Open the repo's `.env` (it already exists for the other secrets
   in this project; if it does not, create it — the file is
   gitignored). Add a line:

   ```dotenv
   NETLIFY_DB_URL=postgres://USER:PASSWORD@HOST:PORT/DBNAME
   ```

   Place it next to the existing `RESEND_API_KEY`, `AUTUMN_API_KEY`,
   etc. Quoting is not required; the dotenv parser used by Netlify
   CLI and by Node's `--env-file` flag handles passwords with
   special characters as long as the value is on a single line.

3. (No restart needed yet — you have not started anything.)

## Running the stack

```sh
npm start
```

This first runs `node --env-file=.env scripts/check-dev-env.mjs`,
which verifies that `NETLIFY_DB_URL` is present. If it is missing,
the preflight prints a single message naming the missing variable
and where to set it, then exits with status 1 — `concurrently` is
never reached and no port is bound.

If the preflight passes, `concurrently` launches:

1. `netlify functions:serve --port=9999` (the functions runtime,
   which loads `.env` automatically and so sees `NETLIFY_DB_URL`)
2. `vite` on `:8888` (the SPA dev front door)

Browse to `http://127.0.0.1:8888` (NOT `localhost`, see CLAUDE.md
for the atproto loopback reason).

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
| Preflight prints "`NETLIFY_DB_URL` is not set …" and exits 1 | Variable is missing from your `.env`. | Add the line per "One-time setup" step 2. |
| Stack starts, but `/api/auth-login` returns 500 with `ECONNREFUSED` / `ENOTFOUND` / `password authentication failed` in the functions log | Variable IS set, but the URL is wrong, the host is down, or the credentials are bad. | Verify the URL in `.env`. Test it with `psql "$NETLIFY_DB_URL"`. |
| Stack starts, but `/api/whoami` returns 500 with `relation "users" does not exist` (or similar) | Variable IS set, host IS reachable, but the database is missing migrations. | Apply `netlify/database/migrations/*.sql` in numeric order against the database. |
| Old `MissingDatabaseConnectionError` page appears again | You bypassed `npm start` (e.g. ran `npx netlify functions:serve` directly without loading `.env`). | Use `npm start` so the preflight runs and `.env` is loaded. |

The three "configured but broken" rows above are deliberately
distinguishable from the first "not configured" row (FR-004) — the
fix path is different for each.

## Picking up a rotated connection string

1. Edit the `NETLIFY_DB_URL=...` line in `.env`.
2. `Ctrl-C` the running `npm start`.
3. `npm start` again.

No code changes, no rebuild, no migration. (FR-007.)

## What this does NOT touch in production

- Deployed Netlify Functions still receive `NETLIFY_DB_URL` from
  Netlify's Database integration. Nothing about this change reaches
  the deployed bundle.
- No new env vars need to be set in the Netlify UI.
- No user-visible behavior changes for signed-in users in
  staging/production.
