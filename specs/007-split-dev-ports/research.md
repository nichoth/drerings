# Research: Split Dev Server Ports

**Branch**: `007-split-dev-ports` | **Date**: 2026-05-27

This document resolves the unknowns in the Technical Context and
records the decisions that shape Phase 1 design.

## Source material

- The user pointed at
  `https://github.com/mycelial-systems/template-netlify-app` as the
  canonical layout. Its `package.json` and `vite.config.ts` are the
  reference shape and are reproduced (verbatim, abbreviated) under
  each decision below.
- The current project today runs `netlify dev` on port `8888`, which
  internally proxies to a Vite dev server on `5173`
  (`netlify.toml [dev]`). `npm start` invokes `netlify dev`.
- `netlify/lib/auth/atproto.ts` currently defaults the dev origin to
  `http://127.0.0.1:9999` when `PUBLIC_URL` is unset. This is the
  current bug source — the browser is on `8888` (where `netlify dev`
  binds), but the redirect URI advertised to the PDS is `9999`. The
  PDS sends the user to `9999`, the cookie is set on `9999`, the SPA
  on `8888` cannot read it.

## Decision 1 — Dev front door is `vite`, functions are separate

**Decision**: `npm start` runs two processes concurrently:

1. `vite` — serves the SPA on port `8888`.
2. `netlify functions:serve --port 9999` — serves only the Netlify
   Functions runtime on port `9999` at `/.netlify/functions/*`.

The two are launched together via `concurrently --kill-others` so
that exiting either tears down both. The mycelial template uses the
exact pattern:

```json
"start": "concurrently --kill-others \"npx ntl functions:serve --port=9999\" \"npx vite\""
```

**Rationale**:

- The browser only ever talks to `8888`. Same-origin is preserved for
  cookies, CSP, and the absence of CORS (FR-012, SC-006).
- `netlify functions:serve` runs the Functions runtime in isolation
  on `9999` and does NOT apply the `netlify.toml` redirect table —
  perfect, because the redirect table is the SPA → function path
  translation we want Vite to own in dev.
- HMR (FR-006 / SC-004) is Vite-native at this layout; restarting the
  functions process does not bounce the SPA and vice versa.
- The dev origin advertised by OAuth client metadata
  (`http://127.0.0.1:8888`) is now actually the origin the browser is
  on, fixing the blank-page-after-callback bug.

**Alternatives considered**:

- *Keep `netlify dev` as the front door, just fix the OAuth default
  origin to `8888`.* Rejected: this is what we have today and it
  works, but the user has explicitly asked to switch to `vite` as the
  dev front door to match the template. Also `netlify dev`'s
  framework auto-detection and HMR-through-proxy add a layer that has
  bitten this project before (the `[dev] command = "vite",
  targetPort = 5173` comment in `netlify.toml` exists because the
  prior heuristic ran the whole vitest suite on every `npm start`).
- *Run only `vite` and call functions directly via an
  in-process plugin.* Rejected: the Netlify Functions runtime
  (`@netlify/functions` v1 Handler, esbuild bundling, ambient env
  loading from `.env`) is non-trivial to host inside Vite, and the
  Netlify CLI already provides `functions:serve` for exactly this
  purpose.

## Decision 2 — Vite proxies `/api/*` to `:9999/.netlify/functions/*`

**Decision**: `vite.config.js` adds a `server.proxy` rule that
forwards browser-visible `/api/<path>` to the Functions runtime on
`9999/.netlify/functions/<name>`. The proxy mirrors every line in the
existing `netlify.toml` redirect table so the browser sees identical
behavior in dev and prod.

**Why this matters**: drerings' function names are deliberately
hyphenated (`auth-login`, `stamps-refund`, …) and the `netlify.toml`
redirect table is the source of truth that maps slash-y URL paths to
those hyphenated function names:

| URL the browser sends | Function the redirect resolves to |
|---|---|
| `/api/auth/login` | `auth-login` |
| `/api/auth/callback` | `auth-callback` |
| `/api/auth/logout` | `auth-logout` |
| `/api/shares/precheck` | `shares-precheck` |
| `/api/shares/confirm` | `shares-confirm` |
| `/api/postcards/send` | `postcards-send` |
| `/api/billing/checkout` | `billing-checkout` |
| `/api/billing/webhook` | `billing-webhook` |
| `/api/stamps/lots` | `stamps-lots` |
| `/api/stamps/transactions` | `stamps-transactions` |
| `/api/stamps/refund/<id>` | `stamps-refund/<id>` |
| `/api/stamps/gifts/checkout` | `stamps-gifts-checkout` |
| `/api/stamps/gifts/refund/<id>` | `stamps-gifts-refund/<id>` |
| `/api/webhooks/resend` | `webhooks-resend` |
| `/api/whoami` (catch-all) | `whoami` (resolved to `whoami/whoami.ts`) |
| `/api/drawings/...` (catch-all) | `drawings/...` (resolved to `drawings/drawings.ts`) |
| `/api/posts/...` (catch-all) | `posts/...` (resolved to `posts/posts.ts`) |
| `/api/account/...` (catch-all) | `account/...` (resolved to `account/account.ts`) |
| `/.well-known/oauth-client-metadata.json` | `oauth-client-metadata` |

The simple `/api/* → /.netlify/functions/:splat` strip used by the
mycelial template is NOT sufficient for drerings, because it would
turn `/api/auth/login` into `/.netlify/functions/auth/login`, which
does not resolve (the function is `auth-login.ts`, flat).

**Implementation shape** (illustrative — Phase 2 task will land it):

```js
// vite.config.js
const apiRewrites = [
  // 1. exact path → function name (mirrors netlify.toml table)
  { from: /^\/api\/auth\/login$/, to: '/.netlify/functions/auth-login' },
  { from: /^\/api\/auth\/callback$/, to: '/.netlify/functions/auth-callback' },
  // ... one entry per netlify.toml redirect ...
  { from: /^\/api\/stamps\/refund\/(.+)$/, to: '/.netlify/functions/stamps-refund/$1' },
  { from: /^\/api\/stamps\/gifts\/refund\/(.+)$/, to: '/.netlify/functions/stamps-gifts-refund/$1' },
  // 2. directory-based functions: strip /api, keep the path
  { from: /^\/api\/(whoami|drawings|posts|account)(\/.*)?$/, to: '/.netlify/functions/$1$2' },
  // 3. .well-known
  { from: /^\/\.well-known\/oauth-client-metadata\.json$/, to: '/.netlify/functions/oauth-client-metadata' },
]

server: {
  port: 8888,
  strictPort: true, // fail loud on conflict, do NOT fall back (FR-010)
  proxy: {
    '/api': {
      target: 'http://127.0.0.1:9999',
      changeOrigin: false, // same-origin from browser POV; Host stays
      rewrite: (path) => {
        for (const r of apiRewrites) {
          if (r.from.test(path)) return path.replace(r.from, r.to)
        }
        return path // unmatched /api/* → 404 from functions runtime
      },
    },
    '/.well-known/oauth-client-metadata.json': {
      target: 'http://127.0.0.1:9999',
      rewrite: () => '/.netlify/functions/oauth-client-metadata',
    },
  },
}
```

**Rationale**:

- The redirect table in `netlify.toml` is the contract; mirroring it
  one-to-one in Vite's proxy means the dev and prod URL shapes stay
  identical and the SPA needs no per-environment branching.
- `strictPort: true` enforces FR-010: if `8888` is bound by another
  process, `vite` exits with a clear error rather than silently
  drifting to `8889`, which would break the OAuth redirect URI.
- We do NOT use `changeOrigin: true`. The Functions runtime does not
  care about the `Host` header for these paths, and leaving the
  original `Host: localhost:8888` keeps any `event.headers.host`
  inspection in functions seeing the SPA-visible origin (relevant if
  any function constructs URLs from `host`).
- The `.well-known` proxy line covers the metadata endpoint at the
  same SPA origin, so the PDS will fetch the metadata document from
  the same origin it later redirects the user to.

**Alternatives considered**:

- *Use the template's naive `'/api': { rewrite: p => p.replace(/^\/api/, '') }`
  with target `http://localhost:9999/.netlify/functions`.* Rejected:
  produces `auth/login` paths that the Functions runtime does not
  know about. Would require renaming every function and removing the
  netlify.toml redirect table — a much bigger change than the user
  asked for.
- *Express the rewrites in a separate `dev-proxy.js` module.*
  Rejected: small enough to keep inline in `vite.config.js`; one
  source of truth is easier to read than two.
- *Use Netlify Edge Functions or a custom dev proxy script.*
  Rejected: Vite's built-in `server.proxy` already does this.

## Decision 3 — OAuth client metadata default origin → `127.0.0.1:8888`

**Decision**: Change
`netlify/lib/auth/atproto.ts:DEFAULT_LOCAL_ORIGIN` from
`'http://127.0.0.1:9999'` to `'http://127.0.0.1:8888'`. `PUBLIC_URL`
remains the production override and is still required in deployed
environments.

**Rationale**: FR-004 / FR-005 / SC-001. The browser is on `8888`;
the metadata document must advertise a `redirect_uri` on `8888` so
the PDS sends the user back to the SPA origin (where the cookie set
during callback is readable). With the new layout, the functions
runtime on `9999` is never user-visible — only Vite's proxy reaches
it. So `127.0.0.1:8888` is the only correct default.

**Edge case** (spec edge-case bullet): `127.0.0.1` vs `localhost`.
The OAuth client metadata uses `127.0.0.1` (because atproto's local
client convention requires loopback). Developers should browse to
`http://127.0.0.1:8888`, not `http://localhost:8888`. We document
this in `quickstart.md` and the README dev section, and Vite's
`server.host = true` ensures both work for serving, but cookies set
on `127.0.0.1:8888` are not visible to `localhost:8888` (or vice
versa) — so the docs need a clear "use 127.0.0.1" note.

**Alternatives considered**:

- *Bind Vite to `localhost` only and use `localhost` in OAuth
  metadata.* Rejected: atproto's loopback client convention
  specifically uses `127.0.0.1` (this is what `getClientId` already
  encodes); mixing in `localhost` would diverge from the
  oauth-client-node library's expectations. See atproto OAuth spec
  for loopback clients.
- *Auto-detect the dev origin from request headers.* Rejected:
  client metadata is requested by the PDS, not the browser, so we
  cannot read the browser's `Host` from there. The env var pattern
  is correct; we just want the default to match the new SPA port.

## Decision 4 — `netlify.toml [dev]` block is removed

**Decision**: Drop the `[dev]` section from `netlify.toml`. It only
exists today to suppress `netlify dev`'s framework auto-detection
heuristic. With `netlify dev` no longer the dev front door, the
section is dead weight, and its presence would confuse a future
contributor who tries `netlify dev` directly.

**Production sections** (`[build]`, `[functions]`, `[[redirects]]`,
`[[headers]]`, `[[context.*]]`) remain untouched (FR-009 / SC-005).

## Decision 5 — Documentation: README and CLAUDE.md updated together

**Decision** (FR-011): Update the "Develop" section of `README.md`
to describe the two-port layout, the `npm start` command, why the
developer should browse to `http://127.0.0.1:8888`, and the override
mechanism (`PUBLIC_URL` plus standard Vite `--port` flag) for port
collisions. Update the matching block in `CLAUDE.md` ("Local
development") to match — today it warns against running `vite`
directly, which is exactly inverted after this change.

## Open questions resolved

| Spec item | Resolution |
|---|---|
| "Use vite as the dev server" | Decision 1 — vite is the front door, `netlify functions:serve` runs alongside |
| "Port 8888 / 9999" | Decisions 1 + 3 — 8888 is SPA + browser-visible, 9999 is internal functions runtime |
| "Setup like mycelial template" | Decision 1 layout + Decision 2 proxy (with a richer rewrite table because drerings has hyphenated function names) |
| OAuth redirect URI alignment | Decision 3 — default origin moves to 8888 |
| Port-collision behavior (edge case) | Decision 2 — `strictPort: true` makes vite exit loudly |
| Same-origin / CORS preservation | Decisions 1 + 2 — browser only sees `:8888`, no new headers, no CORS allowance |
| Production unchanged | Decision 4 — only the dev-only `[dev]` block is removed; build / redirects / headers untouched |
