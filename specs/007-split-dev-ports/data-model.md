# Data Model: Split Dev Server Ports

**Branch**: `007-split-dev-ports` | **Date**: 2026-05-27

This change is dev-infrastructure only — no database tables, no
runtime entities, no migrations. The "entities" here are
configuration values that the dev environment binds together.

## Configuration entities

### Dev SPA Origin

- **Definition**: The scheme + host + port a developer types into
  their browser to reach the running app in local development.
- **Value**: `http://127.0.0.1:8888` by default.
- **Owners**:
  - Vite (`server.port = 8888`, `server.strictPort = true`).
  - OAuth client metadata (`DEFAULT_LOCAL_ORIGIN` in
    `netlify/lib/auth/atproto.ts`, falling back to this when
    `PUBLIC_URL` is unset).
- **Override**: setting `PUBLIC_URL` to a different origin in
  `.env` switches both the OAuth metadata and any URL-construction
  code that reads `PUBLIC_URL`. Vite's port override is a separate
  knob (`--port` flag or `VITE_PORT`); if a developer changes the
  Vite port they MUST also set `PUBLIC_URL` to the matching origin
  or OAuth will break.
- **Invariant**: the origin advertised in the OAuth client metadata
  document MUST equal the origin the developer's browser is on, or
  the cookie set during OAuth callback will not be readable by the
  SPA on its next request.

### Dev Functions Port

- **Definition**: TCP port the `netlify functions:serve` process
  binds, serving the Functions runtime at
  `http://127.0.0.1:<port>/.netlify/functions/<name>`.
- **Value**: `9999` by default.
- **Owners**:
  - `npm start` (passes `--port 9999` to `netlify functions:serve`).
  - Vite proxy (`target: 'http://127.0.0.1:9999'`).
- **Override**: if a developer needs a different port (e.g. `9999`
  is taken), they update BOTH the start command flag AND the
  `target` in `vite.config.js`. The mismatch potential is why we do
  NOT make this port an env var by default — keeping it hard-coded
  in two places that fail loudly together is safer than a single
  env var that gets stale in one of them.
- **Invariant**: the port the Vite proxy targets MUST equal the port
  `netlify functions:serve` binds. A mismatch surfaces as
  `ECONNREFUSED` on every `/api/*` call.

### Dev Proxy Map

- **Definition**: The ordered list of URL → function-path rewrites
  Vite's dev server applies to inbound `/api/*` and
  `/.well-known/oauth-client-metadata.json` requests before
  forwarding them to the Functions runtime on the Dev Functions
  Port.
- **Value**: Mirrors the `[[redirects]]` table in `netlify.toml`
  (one entry per entry). See research.md Decision 2 for the full
  table.
- **Owner**: `vite.config.js` (`server.proxy`).
- **Invariant** (contract — see `contracts/dev-routing.md`): every
  URL pair `(browser → function)` defined in `netlify.toml` MUST be
  reachable via the dev proxy with the same source URL. A new
  redirect added to `netlify.toml` MUST be added to the proxy map
  in the same commit, or `/api/<new-path>` will 404 in dev.

## State transitions

There are no runtime state transitions. The configuration is set
once at process start and held constant for the lifetime of
`npm start`. Changes to `vite.config.js` are picked up by Vite's
own restart-on-config-change behavior; changes to function code are
picked up by `netlify functions:serve`'s rebuild watcher.

## Lifecycle

```text
npm start
  └─ concurrently --kill-others
       ├─ vite                                 [binds 8888, exits on conflict]
       │   └─ proxy /api/*  ─────────► :9999/.netlify/functions/<mapped>
       │   └─ proxy /.well-known/... ─► :9999/.netlify/functions/oauth-client-metadata
       │   └─ serves SPA + HMR on 8888
       └─ netlify functions:serve --port 9999  [binds 9999, exits on conflict]
           └─ rebuilds + reloads functions on src change
```

Killing either child triggers `--kill-others`, which tears down the
other. There is no half-up state to manage.

## Production behavior

Unchanged. In production:

- `PUBLIC_URL` is set to the deployed origin, so OAuth metadata
  advertises the production origin (Decision 3, fallback path
  inert).
- `netlify.toml [[redirects]]` is applied by Netlify's CDN, not by
  any Vite proxy.
- The dev proxy map and `[dev]` block (removed in this change) do
  not exist in deployed contexts.
