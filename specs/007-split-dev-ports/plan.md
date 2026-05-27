# Implementation Plan: Split Dev Server Ports (8888 SPA / 9999 Functions)

**Branch**: `007-split-dev-ports` | **Date**: 2026-05-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/007-split-dev-ports/spec.md`

## Summary

Local dev today runs `netlify dev` on port `8888`, which proxies
internally to a Vite server on `5173`. The OAuth client metadata
defaults its dev origin to `http://127.0.0.1:9999` (`PUBLIC_URL`
unset), so after a successful PDS consent the browser is sent to
`:9999` instead of the SPA origin on `:8888` — and the `drerings_auth`
cookie is set on the wrong host. The user sees a blank page and
`/api/whoami` 401s afterward because the cookie is unreachable.

This change makes `vite` the dev front door on `8888` (the SPA
origin) and runs `netlify functions:serve` separately on `9999`.
Vite's `server.proxy` forwards `/api/*` and
`/.well-known/oauth-client-metadata.json` to `:9999`, mirroring the
production `netlify.toml` redirect table so the browser sees one
origin. The OAuth metadata default origin moves to
`http://127.0.0.1:8888`. Production is not touched — only the
dev-only `[dev]` block is removed from `netlify.toml`.

Approach follows the
[`mycelial-systems/template-netlify-app`](https://github.com/mycelial-systems/template-netlify-app)
layout (concurrently + vite + `ntl functions:serve --port=9999`),
adapted for drerings' hyphenated function naming via an explicit
proxy rewrite table.

## Technical Context

**Language/Version**: TypeScript 5.8 (ES2022, ESM), Node ≥20.19
**Primary Dependencies**: Vite 7, `@preact/preset-vite`,
  `concurrently`, `netlify-cli` (`netlify functions:serve`),
  `@netlify/functions` v1 Handler, `@atproto/oauth-client-node`
**Storage**: N/A (dev infrastructure change; no DB touch)
**Testing**: existing `vitest` suite (`npm run test:e2e`) plus the
  esbuild+tapout suite (`npm test`). Manual OAuth walkthrough per
  `quickstart.md` is the primary acceptance check for US1.
**Target Platform**: developer workstations (macOS / Linux) running
  Node ≥20.19; deployment target Netlify CDN is unaffected.
**Project Type**: web application (Preact SPA + Netlify Functions)
**Performance Goals**: HMR <1s for `src/` edits (SC-004); first
  `/api/whoami` reachable within 10s of `npm start` (SC-002).
**Constraints**:
- No new CORS allowances; no cookie-flag relaxations (FR-012, SC-006).
- Production routing, headers, OAuth metadata semantics on deployed
  origins MUST remain byte-equivalent to baseline (FR-009, SC-005).
- `strictPort: true` on Vite — fail loud on `:8888` collision, do not
  drift (FR-010).
**Scale/Scope**: single-developer dev environments; no
  multi-tenant or scaling concerns. Two long-running processes.

No `NEEDS CLARIFICATION` items remain — see research.md.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution at `.specify/memory/constitution.md` is
the unfilled template — all sections are placeholders. There are no
ratified principles to gate against.

The implicit gates from the project's own `CLAUDE.md` and
`README.md` are checked instead:

- **Security posture**: same-origin preserved, no CORS, cookies
  still `HttpOnly; Secure; SameSite=Lax` — PASS (FR-012, SC-006;
  research.md Decision 2 keeps `changeOrigin: false`).
- **Production unchanged**: only the `[dev]` block of `netlify.toml`
  is removed; the redirect table, headers, build, and OAuth
  metadata in deployed mode are untouched — PASS (FR-009, SC-005;
  research.md Decision 4).
- **No emoji in code/comments**, no font sizes <1rem, no CSS
  variable-bypass — not applicable; this change touches no CSS and
  no UI strings.
- **TypeScript style** (no-space `:type`, 80-col, nested CSS, `batch`
  around multi-signal sets) — applicable only if any frontend file
  is touched. This change is config + a one-line default constant;
  style applies trivially.

**Initial check**: PASS. **Post-design check**: PASS (no design
choice in Phase 1 introduces a new violation; same-origin, no-CORS,
prod-untouched guarantees survive Decision 2's proxy map).

## Project Structure

### Documentation (this feature)

```text
specs/007-split-dev-ports/
├── plan.md                         # This file (/speckit.plan output)
├── spec.md                         # Feature spec (already present)
├── research.md                     # Phase 0 — decisions + alternatives
├── data-model.md                   # Phase 1 — config entities
├── quickstart.md                   # Phase 1 — post-change dev walkthrough
├── contracts/
│   └── dev-routing.md              # Phase 1 — dev URL→function contract
└── tasks.md                        # Phase 2 (/speckit.tasks; not by this cmd)
```

### Source Code (repository root) — files this change will touch

```text
package.json                        # "start" script: concurrently + vite + functions:serve
vite.config.js                      # server.port=8888, strictPort, proxy map
netlify.toml                        # remove [dev] block; everything else unchanged
netlify/lib/auth/atproto.ts         # DEFAULT_LOCAL_ORIGIN: :9999 → :8888
README.md                           # update Develop section
CLAUDE.md                           # update Local development section
```

**Untouched**: every file under `netlify/functions/**`, every file
under `src/**`, every migration under `netlify/database/migrations`,
the production `[[redirects]]` / `[[headers]]` / `[build]` /
`[functions]` / `[[context.*]]` sections of `netlify.toml`. No new
files in `src/`; no new files in `netlify/`.

**Structure Decision**: this is a config-only change to an existing
web-app layout (`src/` SPA + `netlify/functions/` serverless). No
new project skeletons or directories are introduced. The
"web application" project type from CLAUDE.md still applies.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Phase 0 — research

Output: [`research.md`](./research.md).

Five decisions resolved, all `NEEDS CLARIFICATION` cleared:

1. Dev front door is `vite`; functions run separately via
   `netlify functions:serve --port 9999`, launched via
   `concurrently --kill-others`.
2. Vite proxies `/api/*` to `:9999/.netlify/functions/*` using an
   explicit rewrite table that mirrors `netlify.toml`'s
   `[[redirects]]` (drerings hyphenates function names; the
   template's naive prefix-strip is insufficient).
3. `DEFAULT_LOCAL_ORIGIN` in `netlify/lib/auth/atproto.ts` moves
   from `http://127.0.0.1:9999` to `http://127.0.0.1:8888` — the
   bug fix for the blank-page-after-callback symptom.
4. `[dev]` block in `netlify.toml` is removed (dead weight once
   `netlify dev` is no longer the dev front door). Production
   sections untouched.
5. `README.md` and `CLAUDE.md` "Develop" / "Local development"
   sections are updated together. Today they explicitly warn against
   running `vite` directly — that warning is inverted by this
   change.

## Phase 1 — design & contracts

Outputs:

- [`data-model.md`](./data-model.md) — three configuration entities
  (Dev SPA Origin, Dev Functions Port, Dev Proxy Map), their owners,
  their invariants, and the dev-process lifecycle. No runtime
  state; no DB tables.
- [`contracts/dev-routing.md`](./contracts/dev-routing.md) — the
  observable URL → function mapping the dev environment MUST
  provide, plus six behavioral guarantees (same-origin, cookie
  scope, OAuth callback alignment, strict port binding, HMR
  isolation, SPA history fallback) and a verification rule pinning
  the dev proxy to the production redirect table.
- [`quickstart.md`](./quickstart.md) — post-change developer
  walkthrough mapped 1:1 to US1–US4 acceptance scenarios, including
  an override recipe for port collisions and a symptom→cause table.

Agent context: refreshed via
`.specify/scripts/bash/update-agent-context.sh claude`.

## Post-design Constitution re-check

Re-evaluated after Phase 1 outputs were written:

- **Same-origin / no CORS**: the contract explicitly forbids adding
  `Access-Control-*` headers (`dev-routing.md` §2.1). PASS.
- **Production unchanged**: the contract's "Out of scope" section
  pins production routing as untouchable, and the project structure
  section enumerates exactly the files touched (none in
  `netlify/functions/**`, none in `src/**`, no migrations). PASS.
- **Cookie semantics**: data-model invariant ("origin advertised in
  OAuth metadata MUST equal browser origin") plus the
  `DEFAULT_LOCAL_ORIGIN` change in Decision 3 enforce SC-001 / FR-005.
  PASS.

No violations to justify in Complexity Tracking.

## Next step

Run `/speckit.tasks` to generate `tasks.md` from these artifacts.
