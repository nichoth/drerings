# Quickstart: Split Dev Server Ports

**Branch**: `007-split-dev-ports` | **Date**: 2026-05-27

This is the post-change developer experience. Read this section of
`README.md` after the change lands; it documents the new shape.

## What changes

- `npm start` runs **two** processes concurrently:
  - Vite on port `8888` (serves the SPA, owns `/api/*` proxying).
  - `netlify functions:serve` on port `9999` (serves the Functions
    runtime; not directly user-visible).
- You browse to **`http://127.0.0.1:8888`** (not `localhost`, not
  `:9999`).
- The Vite proxy forwards `/api/*` and
  `/.well-known/oauth-client-metadata.json` to the Functions
  runtime on `9999`. From the browser's POV everything is
  same-origin on `8888`.

## Start the dev stack

```sh
npm start
```

Expect to see two log streams interleaved. Within ~10 seconds:

- Vite reports `Local:  http://127.0.0.1:8888/`.
- Netlify CLI reports `Functions server is listening on 9999`.

If either fails to bind, the whole command exits (we use
`concurrently --kill-others`). Most commonly that's a port
collision: another project is already on `8888` or `9999`.

## Verify the layout (acceptance walkthrough)

These map 1:1 to the spec's user-story acceptance criteria.

### US2 — single command, both processes up (10 seconds)

```sh
# from a fresh shell after npm start
curl -i http://127.0.0.1:8888/api/whoami
# expect: HTTP/1.1 401  (no session) and a JSON body
```

The `401` proves: (a) Vite served port `8888`, (b) the proxy
routed `/api/whoami` correctly, (c) the function ran on `9999`.
A `404 "Function not found"` here would mean the proxy map and
`netlify.toml` have drifted; see contracts/dev-routing.md.

### US3 — SPA history routing and Vite internals

```sh
# in the browser:
#   navigate to http://127.0.0.1:8888/account
#   hit refresh
# expect: the SPA shell + the account route renders. No 404.

# in devtools Network panel:
#   confirm /src/index.ts, /@vite/client, etc. are served as JS
#   (Content-Type: application/javascript) — not rewritten to HTML.
```

### US1 — atproto OAuth ends on an authenticated page (not blank)

```text
1. Open http://127.0.0.1:8888/ in a browser.
2. Click "Sign in", enter a real Bluesky handle, submit.
3. Approve the consent on your PDS.
4. The PDS redirects back to http://127.0.0.1:8888/api/auth/callback
   → which 302s to /.
5. The SPA loads on / and renders an authenticated route (not blank).
6. Confirm in devtools: a `drerings_auth` cookie is set on
   `127.0.0.1:8888`.
7. Confirm: GET /api/whoami returns 200 with {id, did, handle, ...}.
```

A blank page here would mean the OAuth `redirect_uri` advertised
in the metadata document does NOT match the SPA origin. Check:

```sh
curl -s http://127.0.0.1:8888/.well-known/oauth-client-metadata.json \
  | grep -o '"redirect_uris":\[[^]]*\]'
# expect: ["http://127.0.0.1:8888/api/auth/callback"]
```

If you see `:9999` here, `DEFAULT_LOCAL_ORIGIN` in
`netlify/lib/auth/atproto.ts` was not updated (see research.md
Decision 3) — or you have a stale `PUBLIC_URL` set.

### US4 — production unchanged

```sh
git diff main -- netlify.toml
# expect: the [dev] block is removed; nothing else changes.

npm run build
# expect: same artifacts as a baseline build from main.
```

## Overrides (port collisions)

The defaults assume `8888` and `9999` are free. If one is taken:

- **Override Vite's port**: pass `--port` to vite (e.g. edit the
  start script or run `npx vite --port 8890` manually). After
  changing the port, also set `PUBLIC_URL` to the matching origin
  before starting:
  ```sh
  PUBLIC_URL=http://127.0.0.1:8890 npm start
  ```
  Otherwise OAuth will redirect to the wrong port.
- **Override the functions port**: change `--port 9999` in the
  start script AND the proxy `target` in `vite.config.js`. The two
  MUST agree; a mismatch surfaces as `ECONNREFUSED` on every
  `/api/*` call.

We deliberately do NOT put the functions port behind an env var:
the two places it appears (`package.json` start script, vite proxy
target) are close together and a stale value would fail loudly,
which is the desired behavior.

## When something breaks

| Symptom | Likely cause | Where to look |
|---|---|---|
| `/api/*` returns 404 "Function not found" | proxy map missing an entry from netlify.toml | `vite.config.js` proxy, `contracts/dev-routing.md` |
| `/api/*` returns 502 / `ECONNREFUSED` | functions process did not start, or wrong port | `netlify functions:serve` log; verify port 9999 |
| OAuth lands on a blank page | metadata redirect_uri ≠ browser origin | `netlify/lib/auth/atproto.ts:DEFAULT_LOCAL_ORIGIN` and `PUBLIC_URL` |
| Refresh on `/account` → 404 | Vite SPA fallback misconfigured, or `[dev]` block re-added to netlify.toml | `vite.config.js`, `netlify.toml` |
| Vite started on a different port (e.g. 8889) | `strictPort` not set; another process on 8888 | `vite.config.js` `server.strictPort = true` |
| HMR not firing | HMR websocket URL got proxied as if it were `/api/*` | Vite proxy `match` is `/api` only, not `/` |
