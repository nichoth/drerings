# Phase 0 Research: atproto Sign-In 404 Recurrence

**Date**: 2026-05-21
**Spec**: [spec.md](./spec.md)
**Plan**: [plan.md](./plan.md)

## Root cause investigation

### Symptom (verified)

`GET http://127.0.0.1:8888/api/auth/login?handle=jarving.bsky.social`
returns the bare text `Function not found...`. No 005-style "function
silently undiscovered" — the deployed redirect table is correct after
005. The 404 is local-dev-only.

### The dual-server local workflow

`package.json` defines the documented dev command:

```json
"start": "concurrently --kill-others \"npx ntl functions:serve --port=9999 --debug\" \"npx vite\""
```

This runs two processes:

1. `ntl functions:serve --port=9999` — Netlify's standalone Functions
   server. It discovers files in `netlify/functions/` using the
   classic flat rules, exactly like the deployed runtime. On the
   current branch this means `auth-login`, `auth-callback`,
   `auth-logout`, etc. are registered (as flat files), and the legacy
   names `auth/login`, `auth/callback`, `auth/logout` are NOT
   (because the files are flat now).
2. `npx vite` — the Vite dev server, configured to listen on port
   8888 (per `vite.config.js`) and to proxy `/api/*` to the functions
   server:

   ```js
   server: {
       port: 8888,
       host: true,
       open: true,
       proxy: {
           '/api': {
               target: 'http://localhost:9999/.netlify/functions',
               changeOrigin: true,
               rewrite: path => path.replace(/^\/api/, ''),
           },
       },
   }
   ```

### Why `/api/auth/login` 404s

Trace one request through the dual-server setup:

1. Browser: `GET http://127.0.0.1:8888/api/auth/login?handle=...`
2. Vite proxy matches `/api`, rewrites by stripping the prefix:
   `/auth/login?handle=...`
3. Vite forwards to
   `http://localhost:9999/.netlify/functions/auth/login?handle=...`
4. `ntl functions:serve` looks up a function named `auth/login` in
   its index. The function file is `auth-login.ts`, so the name in
   the index is `auth-login`. No match.
5. `ntl functions:serve` returns `Function not found`.

The fundamental problem: `netlify.toml`'s redirect table translates
`/api/auth/login` → `/.netlify/functions/auth-login` (slash → dash).
The Vite proxy does NOT do that translation — it strips `/api` and
forwards the rest of the path verbatim. So the two routing tables
have diverged silently. `netlify.toml` is correct; the Vite proxy is
the second, stale copy.

This is exactly the failure mode 005's "explicit redirect table"
decision was designed to prevent at the platform layer. But the Vite
proxy duplicates the same translation logic in a separate file, in a
separate format, with no test asserting they agree. The 005 fix
worked deployed but reintroduced the same drift hazard locally.

### Why this only surfaces now

The 005 fix renamed function files. Before 005, the function names
were `auth/login`, `auth/callback`, etc. (matching the URL path after
`/api/`), and the Vite proxy's verbatim path forwarding happened to
agree. After 005, the function names are `auth-login`, etc., and the
verbatim forwarding stops matching. 005 was a deploy-correct fix
that didn't surface its local-dev consequence until a contributor
ran the dev server and tried to sign in.

### Verification points

- `ls netlify/functions/` shows the flat-file layout from 005:
  `auth-login.ts`, `auth-callback.ts`, `auth-logout.ts`, etc.
- `netlify.toml` `[[redirects]]` block translates `/api/auth/login`
  → `/.netlify/functions/auth-login`. Source of truth for prod.
- `vite.config.js` `server.proxy` block translates `/api/auth/login`
  → `/.netlify/functions/auth/login`. Stale.
- `src/routes/login.ts:19` — client calls
  `` `/api/auth/login?handle=${...}` ``. Unaffected; the URL
  contract stays `/api/...`.
- `src/state.ts:309` — client calls
  `fetch('/api/auth/logout', { method: 'POST' })`. Same.
- The bare text "Function not found" is the canonical response body
  from `@netlify/cli`'s `functions:serve` when the function name is
  unknown. Reproduces in isolation by
  `curl http://localhost:9999/.netlify/functions/anything-unknown`.

## Decision: switch local dev to `netlify dev`

**Decision**: Replace the dual-process `npm start` (concurrent `ntl
functions:serve` + `npx vite`) with a single `netlify dev` command.
`netlify dev` is the Netlify-native development tool. It auto-detects
the Vite SPA, starts Vite under the hood, mounts the functions
server, and serves everything on one port (default 8888) through the
same redirect table production uses (`netlify.toml`). This collapses
the duplicate routing config into a single source of truth.

**Rationale**:

- **Single source of truth.** `netlify.toml` is the only file that
  defines how `/api/*` URLs reach functions. The Vite proxy is
  removed; there is no second config to drift.
- **Same code path as prod.** `netlify dev` exercises the redirect
  table the same way the deployed environment does. A working dev
  request proves the prod routing works (and vice versa). The
  failure mode that motivated 005/006 — different routing in dev vs
  prod — disappears structurally.
- **Already installed.** `netlify-cli` ^23.4.3 is in
  `devDependencies` (it's what the current `start` script already
  invokes via `npx ntl`). No dependency change.
- **Port preserved.** `netlify dev` defaults to port 8888 — the
  exact port the user repro'd on, the port `vite.config.js`
  currently sets, and the port baked into developers' muscle memory.
  No bookmark or doc breaks.
- **First-request reachability** (spec FR-005). `netlify dev`
  compiles functions on demand using esbuild and waits for the
  compile to finish before responding. The first request blocks
  briefly (typically <1s for a small function) instead of returning
  a 404. The "function compiling, try again" failure window the
  spec calls out is structurally avoided.

**Alternatives considered**:

1. **Keep the dual-server setup and fix the Vite proxy rewrite.**
   Translate `/api/auth/login` → `/.netlify/functions/auth-login` in
   the Vite proxy using either a custom `rewrite` that mirrors the
   `netlify.toml` table, or a `bypass` function. Rejected: this
   restores feature parity but DOES NOT collapse the two routing
   tables. The proxy would still be a hand-maintained duplicate of
   `netlify.toml`, and the next endpoint added or renamed silently
   drifts again. This is the foot-gun 005's research.md called out
   verbatim ("the wildcard was the silent-failure surface that hid
   this bug") — applied to a different config file.
2. **Add a Vite plugin that reads `netlify.toml` at dev-server
   start and synthesizes the proxy rewrites.** Rejected: more code
   to maintain, depends on a toml parser, and reinvents what
   `netlify dev` does natively. Worth zero engineering hours when
   `netlify dev` is one line of script change away.
3. **Migrate to Netlify Functions v2 with self-routing
   (`export const config = { path: '/api/auth/login' }`).** Same
   rejection as 005's research.md — the v2 migration touches every
   handler's signature, response helpers, and tests. Out of scope
   for a P1 outage recurrence fix. Eligible as a follow-up.
4. **Document the dual-server workflow with a Vite proxy fix and
   call it done.** Rejected. Fixing the proxy strings makes the
   immediate bug go away but leaves the drift surface intact and
   sets up 007.

## Decision: remove the Vite proxy block

**Decision**: Delete the `server.proxy` block from `vite.config.js`.
Keep `port: 8888`, `host: true`, `open: true` so anyone running
`npx vite` standalone still sees the same port — but standalone Vite
no longer pretends to handle `/api/*`. Standalone Vite is not the
supported dev workflow; `netlify dev` is.

**Rationale**:

- The proxy is the duplicated routing table. Removing it removes
  the drift surface entirely.
- Leaving the proxy in place but broken (or out of date) creates the
  same silent-failure mode for any contributor who runs `npx vite`
  alone. Better to have `/api/*` fail loudly with a Vite 404 (no
  upstream configured) than to silently route to a 9999 server that
  isn't running.
- The Vite `port: 8888` setting is retained so the unsupported
  `npx vite` mode still serves the SPA on the same port as
  `netlify dev` does. This makes the README's single command stay
  consistent with anyone who pokes at `vite` directly.

**Alternatives considered**:

1. **Delete the entire `server` block.** Rejected: doing so changes
   Vite's default port to 5173, which breaks the consistency
   benefit above. Cost of retaining `port: 8888` is one line.
2. **Add a console warning when the proxy is hit and points
   nowhere.** Rejected: speculative engineering; `netlify dev` is
   the supported entry point and standalone `vite` is a power-user
   escape hatch.

## Decision: rewrite the `start` script

**Decision**: Change `package.json#scripts.start` from the
`concurrently` invocation to a single `netlify dev` command:

```json
"start": "netlify dev"
```

No flags needed — `netlify dev` auto-detects the project (presence
of `netlify.toml`, the Vite `build.outDir`, and the `functions`
directory). The README continues to say "run `npm start`," so the
contributor surface contract is unchanged.

**Rationale**:

- One command. One process. One port. One redirect table.
- `netlify-cli` (`netlify` binary) is already in `devDependencies`,
  so `npm start` resolves it through node_modules — no global
  install required.
- The flag `--debug` from the prior script (used on
  `ntl functions:serve`) is omitted because it was producing noisy
  output and the new failure mode (a redirect that doesn't resolve)
  is caught by the static-analysis test before runtime.

**Alternatives considered**:

1. **Keep `concurrently` but run `netlify dev` and something else
   in parallel.** Rejected: there is no second process to run.
2. **Add a `start:functions-only` script for backend-only
   debugging.** Rejected as out of scope. A contributor who needs
   to debug a function without the SPA can `npx netlify functions:
   invoke <name>` or call the function URL directly under
   `netlify dev`. No new script needed for this fix.

## Decision: add a static-analysis test that asserts redirect/file alignment

**Decision**: Add a new test
`test/netlify-toml-routing.test.ts` (registered in
`test/index.ts`) that:

1. Parses `netlify.toml` for every `[[redirects]]` block whose `to`
   matches the pattern `/.netlify/functions/<name>` (with optional
   `/:splat` suffix).
2. For each such redirect, asserts that the file
   `netlify/functions/<name>.ts` exists.
3. Also asserts the inverse: for each file
   `netlify/functions/<name>.ts` that is not a scheduled job
   (`refund-expired-gifts.ts`, `verify-stamp-invariants.ts`) and not
   already a webhook-only path (`webhooks-resend.ts`,
   `billing-webhook.ts`, `oauth-client-metadata.ts`), there exists
   at least one redirect whose `to` references that function name.

The test runs under `npm test` (the tapout-bundled suite). It does
NOT spin up `netlify dev` or any HTTP server; it is a pure file/text
check, fast and deterministic.

**Rationale**:

- It catches the 005 regression class directly: the pre-005 branch
  had `netlify.toml` pointing at `/.netlify/functions/auth/login`
  with no corresponding `auth-login.ts` (or whatever name) — the
  test would have failed.
- It catches the more general "redirect added without function" or
  "function added without redirect" drift class on the same commit,
  not in production logs.
- It is a static check — no network, no DB, no flake. Honors the
  `CLAUDE.md` "do not write brittle tests" rule because it asserts
  on file existence and a parsed config structure, not on response
  bodies or HTML.

**Alternatives considered**:

1. **End-to-end test that spawns `netlify dev` and curls each
   redirect.** Rejected as the primary check: too slow, too flaky
   for CI, brings the OAuth client + Postgres into scope of a
   routing test. Acceptable as a smoke test in `vitest run`
   (`test:e2e`) but not as the primary guard. Out of scope to add
   in this branch; the static check covers the regression class.
2. **Snapshot test of the redirect table.** Rejected: doesn't
   catch drift between table and files, only catches table edits.
3. **Skip the test; rely on the manual quickstart.** Rejected:
   FR-009 in the spec requires an automated test for this defect
   class so the bug cannot resurface a third time without CI
   noticing.

## Decision: documentation in README + `CLAUDE.md`

**Decision**: Update the README's "Develop" section to make the
canonical command explicit and to add one sentence on WHY (so a
future contributor doesn't re-introduce the dual-server pattern).
Add a one-line note in `CLAUDE.md` under "Active Technologies" or a
new "Local development" section pointing at the README.

Specifically the README "Develop" block becomes:

```md
## Develop

```sh
npm start
```

This runs `netlify dev`, which serves the Preact SPA and Netlify
Functions on `http://localhost:8888` and applies the `netlify.toml`
redirect table just like the deployed environment. Do not run
`vite` or `netlify functions:serve` directly — they bypass the
redirect table and you will see "Function not found" on `/api/*`.
```

**Rationale**:

- Spec FR-010 requires the supported workflow to be documented in
  the repo root README and `CLAUDE.md`.
- The "why" sentence is what prevents 007. It costs ~30 words and
  saves the next 005/006 cycle.

**Alternatives considered**: none. Documentation alone without the
code/test changes does not satisfy FR-001 through FR-009.

## Open questions

None. All `NEEDS CLARIFICATION` items resolved.

## References

- Spec [spec.md](./spec.md) — FR-001 to FR-010 and SC-001 to SC-006.
- `005-fix-auth-login-404/plan.md` and `005-fix-auth-login-404/
  research.md` — prior fix that flattened the function files and
  introduced the dash-named convention.
- `vite.config.js:33-39` — the duplicate-routing-table source of
  the recurrence.
- `package.json#scripts.start` — the dev workflow being replaced.
- `netlify.toml` — the redirect table that becomes the single
  source of truth for both dev and prod after this fix.
- `netlify/functions/auth-login.ts:10-41` — handler whose body is
  unchanged and whose reachability this plan restores.
- Netlify CLI docs: `netlify dev` auto-detects Vite, Next.js,
  Astro, etc. via the `@netlify/build` framework-info plugin.
