# Implementation Plan: atproto Sign-In 404 Recurrence (`/api/auth/login`)

**Branch**: `006-fix-auth-login-404` | **Date**: 2026-05-21 | **Spec**:
[spec.md](./spec.md)
**Input**: Feature specification from
`/Users/nick/code/drerings/specs/006-fix-auth-login-404/spec.md`

## Summary

`GET /api/auth/login?handle=<handle>` returns the bare text
`Function not found...` when the contributor runs the documented
local dev workflow (`npm start`). The 005 fix flattened
`netlify/functions/auth/login.ts` to `netlify/functions/auth-login.ts`
and updated `netlify.toml` so deployed environments route correctly.
But `npm start` is `concurrently --kill-others "npx ntl
functions:serve --port=9999" "npx vite"`, and `vite.config.js` proxies
`/api/*` to `http://localhost:9999/.netlify/functions/<path>` with a
verbatim `rewrite: path => path.replace(/^\/api/, '')`. The proxy
strips `/api` and forwards `auth/login` to `ntl functions:serve`,
which has no function by that name (only `auth-login`). The function
server replies `Function not found` and the user sees the same 404
symptom as 005, even though the deployed redirect table is correct.

`netlify.toml` is now the routing source of truth for production, but
the Vite proxy duplicates a second, stale copy of that table in
`vite.config.js`. Every future endpoint rename or addition needs to
be made in two places, and silent drift between them is exactly the
class of bug 005 promised to eliminate.

The fix collapses the two routing tables into one by switching the
local dev workflow to `netlify dev`, which reads `netlify.toml`
directly. `netlify dev` is already in `devDependencies` as
`netlify-cli` ^23.4.3 and is the supported Netlify-native development
tool — it auto-detects the project's Vite SPA, proxies static assets
through Vite, mounts functions on the same origin (port 8888 by
default), and applies the same redirect table production uses.

Concretely:

1. Replace the `start` script with `netlify dev` (port 8888 preserved
   for muscle memory and parity with the spec's symptom URL).
2. Delete the `server.proxy` block from `vite.config.js`. `netlify
   dev` proxies `/api/*` through the redirect table, so the Vite
   proxy is no longer needed; leaving it in is a foot-gun for anyone
   who runs `npx vite` standalone.
3. Update `README.md` to document `netlify dev` (via `npm start`) as
   the canonical dev command, with a one-line "why" so future
   contributors don't restore the dual-server pattern.
4. Add a static-analysis test that asserts every `[[redirects]]`
   entry in `netlify.toml` whose `to` points at `/.netlify/functions/
   <name>` resolves to a file in `netlify/functions/<name>.ts`. This
   would have failed on the pre-005 branch (no `auth-login.ts`) and
   continues to fail any future redirect-vs-function drift. The test
   runs under `npm test` so CI catches the regression class without
   needing a live dev server.

Handler bodies, the atproto OAuth flow, rate-limit gates, session
cookie contract, postcard CAS state machine, share-event invariants,
stamp accounting, billing flow, and `oauth-client-metadata.json`
cacheability are untouched.

## Technical Context

**Language/Version**: TypeScript 5.8 (ES2022, ESM), Node >=20.19
**Primary Dependencies**: `@netlify/functions` ^4.1.8 (v1 `Handler`,
unchanged), `netlify-cli` ^23.4.3 (already a devDep — `netlify dev`
binary), `vite` ^7.0.0
**Storage**: Postgres (Netlify DB) — schema unchanged by this fix
**Testing**: vitest (`npm run test:e2e`), tapout-bundled tests
(`npm test`) — both stay file-level; new static-analysis test added
to the tapout suite to assert `netlify.toml` redirects resolve to
real function files
**Target Platform**: Netlify Functions (esbuild bundler) +
static-hosted Preact SPA; reproduces on local Netlify dev at
`127.0.0.1:8888` (same port `netlify dev` defaults to, preserved
across the workflow swap)
**Project Type**: Web application — Preact SPA in `src/` + Netlify
Functions in `netlify/functions/` (flat layout from 005)
**Performance Goals**: No perf change. Cold-start time of `netlify
dev` (~2-3s on a warm cache) is comparable to the dual-server
`concurrently` start.
**Constraints**: Must not regress any other endpoint; must keep
`/.well-known/oauth-client-metadata.json` cacheable; must not alter
the session cookie payload, HMAC signing, OAuth scopes, or stamp-
accounting invariants; must preserve port 8888 so contributors'
existing bookmarks and the spec's repro URL keep working.
**Scale/Scope**: 1 `package.json` script change, 1 `vite.config.js`
edit (drop `server.proxy`), 1 README section rewrite, 1 new
static-analysis test, optional 1 `CLAUDE.md` note. No file moves, no
SQL migrations, no client-state changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1
design.*

The project's `.specify/memory/constitution.md` is the unfilled
template — no project-specific principles have been ratified. The
general gates from `~/.claude/CLAUDE.md` and the project `CLAUDE.md`
that apply are:

- **No CSS changes unrelated to the task** — N/A; no CSS touched.
- **No eslint changes** — N/A; lint config untouched.
- **No brittle tests / no asserting raw HTML text** — Honored; the
  new test asserts file-existence and a `netlify.toml` parse, not UI
  output.
- **TypeScript style** (no space after `:`, 80-col, ternary
  formatting) — Honored. The only TS surface in scope is the new
  static-analysis test, written in the project style.
- **`@preact/signals` + `batch()`** — N/A; no client state changes.
- **Plan first, then code** — Honored by this plan.
- **No emojis** — Honored.
- **Append-only stamp ledger / postcard CAS / share invariants** —
  Untouched.
- **HSTS / X-Frame / CSP headers in `netlify.toml`** — Preserved
  byte-for-byte; only the redirect table is read, not rewritten.
- **CORS still not configured** — Preserved.
- **`json()` defaults to `Cache-Control: private, no-store`** —
  Untouched; `oauth-client-metadata` keeps its cacheable opt-out.
- **Auth-login handler behavior** — Per spec FR-006, all current
  handler behaviors are preserved (rate limit 10/min/IP, handle
  validation, redirect to PDS with `atproto transition:generic`
  scopes, session cookie issuance, atproto session revocation on
  logout). Nothing in this plan touches handler bodies.

**Initial Constitution Check: PASS.** No violations to justify.

**Post-Phase-1 re-check** (after research.md, data-model.md,
contracts/, quickstart.md were written): **PASS.** The Phase 1
artifacts describe routing and dev-workflow contracts, not new code.
No new dependencies, no schema changes, no client state changes, no
CSS, no test relaxations, no `Cache-Control` weakening, no CORS
additions, no handler behavior changes. The fix remains a dev-
workflow consolidation plus a single guardrail test.

## Project Structure

### Documentation (this feature)

```text
specs/006-fix-auth-login-404/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (this command)
├── data-model.md        # Phase 1 output (routing contract; no DB)
├── quickstart.md        # Phase 1 output (reproduce + verify)
├── contracts/           # Phase 1 output
│   └── routing.md       # /api/* → flat-function contract;
│                        # single source of truth = netlify.toml
└── spec.md              # Feature spec (input)
```

### Source Code (repository root)

```text
netlify/
├── functions/                 # FLAT (from 005) — unchanged
│   ├── account.ts
│   ├── auth-callback.ts
│   ├── auth-login.ts          # root-cause file from 005; unchanged
│   ├── auth-logout.ts
│   ├── billing-checkout.ts
│   ├── billing-webhook.ts
│   ├── drawings.ts
│   ├── oauth-client-metadata.ts
│   ├── postcards-send.ts
│   ├── posts.ts
│   ├── refund-expired-gifts.ts
│   ├── shares-confirm.ts
│   ├── shares-precheck.ts
│   ├── stamps-gifts-checkout.ts
│   ├── stamps-gifts-refund.ts
│   ├── stamps-lots.ts
│   ├── stamps-refund.ts
│   ├── stamps-transactions.ts
│   ├── verify-stamp-invariants.ts
│   ├── webhooks-resend.ts
│   └── whoami.ts
└── lib/                       # UNCHANGED — domain logic stays put

netlify.toml                   # UNCHANGED — redirect table is now
                               # both the prod and dev source of truth

vite.config.js                 # `server.proxy` block removed; build/
                               # css/plugin config unchanged

package.json                   # `start` script replaced; no dep
                               # changes (netlify-cli already devDep)

README.md                      # Develop section rewrites the
                               # canonical command + a one-line why

test/
└── netlify-toml-routing.test.ts   # NEW — static analysis: every
                                   # /api/* redirect resolves to a
                                   # netlify/functions/<name>.ts file
```

**Structure Decision**: The 005 file layout (flat functions, explicit
redirects in `netlify.toml`) is correct and stays. This plan changes
the dev workflow so it uses the same redirect table. The new test
asserts the invariant that `[[redirects]]` entries and function files
stay in sync, replacing the silent-failure surface that the
duplicate Vite proxy rewrite was creating. No new directories are
introduced.

## Complexity Tracking

No constitution violations — section intentionally empty.
