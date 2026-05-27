# Phase 1 Contracts: Fix Missing Database Connection in Local Dev

**Branch**: `008-fix-db-connection` | **Date**: 2026-05-27

## No external interface contracts changed

This feature does not change any public-facing contract of the
project. Specifically:

- **HTTP API contracts** (`/api/*` endpoints, `/.well-known/...`):
  unchanged. Request shapes, response shapes, status codes, error
  bodies, headers, and `Cache-Control` defaults are identical to
  before this change. `/api/auth-login` continues to return a 302
  redirect to the user's PDS on success — the fix is that this code
  path can now actually be reached in local dev, not that its shape
  has changed.
- **`@netlify/database` `getDatabase()` contract**: unchanged.
  Callers continue to invoke `getDatabase()` with no arguments and
  receive a `DatabaseConnection`. The fix simply ensures the env var
  the library reads (`NETLIFY_DB_URL`) is present.
- **Internal lib contracts** (`netlify/lib/*`): unchanged. The same
  exports (`debitStamp`, `recordShare`, `refundPostcardBounce`,
  `checkAndIncrement`, `getSession`, etc.) keep their existing
  signatures.

## New internal "contract" worth recording

There is one new internal contract introduced by this work — a
shell-level convention, not an API:

- **Preflight contract** (`scripts/check-dev-env.mjs`): exits with
  code `0` when `process.env.NETLIFY_DB_URL` is a non-empty string,
  exits with code `1` and writes a single human-readable message
  to `stderr` otherwise. The message names the missing variable,
  the file to set it in (`.env`), and the README anchor to consult
  for how to obtain a value. This script is invoked only from the
  `npm start` script via `node --env-file=.env`; it is not imported
  by any function bundle.

This is intentionally not a programmatic contract — it has no
consumers other than the `npm start` shell pipeline. It is recorded
here so future maintainers know not to import it from elsewhere.

## Deployed-runtime contract (explicitly unchanged)

The Netlify Functions runtime in production/preview/branch continues
to receive `NETLIFY_DB_URL` via Netlify's Database integration, the
same mechanism that worked before this change. No new env vars must
be set in the Netlify UI. No new build hooks. No new redirects. No
new headers. The deployed contract surface is intentionally inert
under this change (FR-008, SC-005).
