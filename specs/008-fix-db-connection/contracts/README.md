# Phase 1 Contracts: Fix Missing Database Connection in Local Dev

**Branch**: `008-fix-db-connection` | **Date**: 2026-05-27
**Revision**: 2 — replaces revision 1's "preflight contract" with a
"dev-stack composition contract" matching the
`@netlify/vite-plugin` approach. See research.md Decision 2.

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
  the library reads (`NETLIFY_DB_URL`) is present in the functions
  runtime — via `@netlify/vite-plugin`'s embedded `@netlify/dev`
  orchestrator instead of via a developer-edited `.env`.
- **Internal lib contracts** (`netlify/lib/*`): unchanged. The same
  exports (`debitStamp`, `recordShare`, `refundPostcardBounce`,
  `checkAndIncrement`, `getSession`, etc.) keep their existing
  signatures.

## Internal dev-stack composition contract (recorded)

There is one new internal "contract" worth recording — a
configuration shape, not an API:

- **Vite plugin composition** (`vite.config.js`):
  `netlify()` from `@netlify/vite-plugin` MUST be registered in the
  `plugins` array **before** `preact()`. The plugin's
  `configureServer` hook installs the request-interception
  middleware that routes `/api/*` to the local Functions runtime
  and exposes the auto-provisioned `NETLIFY_DB_URL` to it. If the
  plugin is removed or commented out, `MissingDatabaseConnectionError`
  returns. If it is registered *after* a plugin that also installs
  middleware on the same paths, ordering surprises become possible
  — current registration is `[netlify(), preact(...)]`.

## Removed contract — dead `:9999` proxy

`vite.config.js`'s `server.proxy` table previously contained two
entries:

```js
proxy: {
  '/api': { target: 'http://127.0.0.1:9999', ... },
  '/.well-known/oauth-client-metadata.json': { target: 'http://127.0.0.1:9999', ... },
}
```

These were the spec-007 plumbing that forwarded SPA requests to a
separately-running `netlify functions:serve` process. They are
removed by this work because (a) `netlify functions:serve` no
longer runs at all in `npm start`, so `:9999` is never bound, and
(b) the `@netlify/vite-plugin` middleware intercepts the same paths
*before* Vite's proxy layer ever fires. A request escaping to the
dead proxy would have failed with `ECONNREFUSED` — a strictly worse
error than letting the plugin's middleware return a clean 404 (or,
in normal operation, the function response).

The corresponding `[[redirects]]` entries in `netlify.toml` are NOT
removed — those still apply to deployed environments, where Netlify's
own redirects engine consumes them, and to the plugin's emulated
redirects engine in dev (which also reads `netlify.toml`).

## Deployed-runtime contract (explicitly unchanged)

The Netlify Functions runtime in production / preview / branch
continues to receive `NETLIFY_DB_URL` via Netlify's Database
integration, the same mechanism that worked before this change.
No new env vars must be set in the Netlify UI. No new build hooks.
No new redirects. No new headers. The deployed contract surface is
intentionally inert under this change (FR-008, SC-005).
`@netlify/vite-plugin` lives in `devDependencies` only and is not
referenced from any file in the deployed Functions bundle.
