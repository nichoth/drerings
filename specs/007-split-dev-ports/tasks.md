---
description: "Task list for Split Dev Server Ports (8888 SPA / 9999 Functions)"
---

# Tasks: Split Dev Server Ports (8888 SPA / 9999 Functions)

**Input**: Design documents from `/specs/007-split-dev-ports/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
  contracts/dev-routing.md, quickstart.md

**Tests**: Not requested by spec. Acceptance is via the manual
walkthrough in `quickstart.md`; the existing `npm test` and
`npm run test:e2e` suites must continue to pass but no new automated
tests are introduced by this work.

**Organization**: Tasks are grouped by user story so each story is
independently testable. The feature is config-only — most of the
file-touching work falls in Phase 2 (Foundational) because it is a
shared prerequisite for US1, US2, and US3. The per-story phases
that follow are predominantly verification + the small story-scoped
edits that remain (notably the `DEFAULT_LOCAL_ORIGIN` fix for US1
and the `netlify.toml [dev]` removal for US4).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Include exact file paths in descriptions

## Path Conventions

This is a Preact SPA + Netlify Functions web app. Source paths:

- SPA: `src/`
- Functions: `netlify/functions/`
- Function domain libs: `netlify/lib/`
- Build/dev config: `vite.config.js`, `netlify.toml`, `package.json`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm preconditions before touching config.

- [ ] T001 Verify `concurrently` and `netlify-cli` are present in `devDependencies` of `/Users/nick/code/drerings/package.json` (both are; no install needed). If either is missing, run `npm install --save-dev concurrently netlify-cli` before continuing.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Stand up the two-port dev layout (Vite on 8888, Functions on 9999) that every user story depends on. After this phase, the dev stack runs but OAuth still redirects to the wrong origin until US1 lands.

**CRITICAL**: No user story work can be verified until this phase is complete.

- [ ] T002 Replace the `"start"` script in `/Users/nick/code/drerings/package.json` with `concurrently --kill-others "npx netlify functions:serve --port=9999" "npx vite"`. Keep the rest of the `scripts` block untouched (`build`, `test`, `test:e2e`, `lint`, etc. all remain).
- [ ] T003 Update `/Users/nick/code/drerings/vite.config.js` `server` block: set `port: 8888`, `strictPort: true`, `host: true`. Replace the existing `// Vite runs behind 'netlify dev'` comment with one noting Vite is now the dev front door on 8888. Do NOT touch the `define`, `plugins`, `esbuild`, `publicDir`, `css`, or `build` blocks.
- [ ] T004 In the same `server` block of `/Users/nick/code/drerings/vite.config.js`, add a `proxy` map per research.md Decision 2: rewrite `/api/*` and `/.well-known/oauth-client-metadata.json` to `http://127.0.0.1:9999/.netlify/functions/<name>` using an explicit rewrite table that mirrors every `[[redirects]]` entry in `/Users/nick/code/drerings/netlify.toml` (auth-login, auth-callback, auth-logout, shares-precheck, shares-confirm, postcards-send, billing-checkout, billing-webhook, stamps-lots, stamps-transactions, stamps-refund/<id>, stamps-gifts-checkout, stamps-gifts-refund/<id>, webhooks-resend, plus the directory-based catch-alls for `whoami`, `drawings`, `posts`, `account`). Set `changeOrigin: false` so `Host` is preserved (research.md Decision 2). Scope proxy keys to `/api` and `/.well-known/oauth-client-metadata.json` only — DO NOT proxy `/`, `/src/*`, or `/@vite/*` (FR-008).

**Checkpoint**: `npm start` brings up Vite on 8888 and `netlify functions:serve` on 9999 concurrently; `curl http://127.0.0.1:8888/api/whoami` reaches the function. OAuth still fails until US1.

---

## Phase 3: User Story 1 - OAuth sign-in completes in local dev (Priority: P1) — MVP

**Goal**: A developer can run `npm start`, click "Sign in", complete consent on their PDS, and land on an authenticated route on the SPA origin with `/api/whoami` returning 200.

**Independent Test**: From `http://127.0.0.1:8888/`, click "Sign in", enter a real Bluesky handle, approve consent on the PDS. Browser lands on an authenticated route (not blank). DevTools confirms a `drerings_auth` cookie is set on `127.0.0.1:8888`. `GET /api/whoami` returns 200 with `{ id, did, handle, stamps_balance }`.

### Implementation for User Story 1

- [ ] T005 [US1] Edit `/Users/nick/code/drerings/netlify/lib/auth/atproto.ts`: change `DEFAULT_LOCAL_ORIGIN` from `'http://127.0.0.1:9999'` to `'http://127.0.0.1:8888'` (research.md Decision 3). Do not touch `getClientId` or any other constants in this file. Leave the `PUBLIC_URL` override path untouched — it is still authoritative in deployed environments.

### Verification for User Story 1

- [ ] T006 [US1] Run `npm start`, then `curl -s http://127.0.0.1:8888/.well-known/oauth-client-metadata.json | grep -o '"redirect_uris":\[[^]]*\]'` and confirm the value is `["http://127.0.0.1:8888/api/auth/callback"]` (quickstart.md US1 troubleshooting block). Any occurrence of `:9999` here means T005 was not applied or a stale `PUBLIC_URL` is set in `.env`.
- [ ] T007 [US1] Execute the full quickstart.md US1 walkthrough end-to-end in a browser at `http://127.0.0.1:8888/`: sign in with a real Bluesky handle, approve consent, land on an authenticated route (not blank), confirm the `drerings_auth` cookie is scoped to `127.0.0.1:8888`, and confirm `GET /api/whoami` returns 200 with the user fields populated. This satisfies SC-001.

**Checkpoint**: OAuth sign-in completes end-to-end in dev. The MVP is shippable.

---

## Phase 4: User Story 2 - Single-command dev stack (Priority: P2)

**Goal**: `npm start` brings up both the SPA on 8888 and the Functions runtime on 9999 within 10 seconds, with `/api/*` reachable through the SPA origin and HMR working without restarting either process.

**Independent Test**: From a fresh shell after `npm start`: (a) `http://localhost:8888/` serves the SPA, (b) `curl -i http://127.0.0.1:8888/api/whoami` returns 401 within 10 seconds, (c) editing a file under `src/` triggers HMR without bouncing the functions process.

### Verification for User Story 2

- [ ] T008 [US2] Run `npm start` in a clean shell and confirm both log streams appear within ~10 seconds: Vite reports `Local: http://127.0.0.1:8888/`, Netlify CLI reports `Functions server is listening on 9999`. Failure of either MUST kill both (concurrently `--kill-others`).
- [ ] T009 [US2] With `npm start` running, `curl -i http://127.0.0.1:8888/api/whoami` and confirm `HTTP/1.1 401` with a JSON body (SC-002). A `404 "Function not found"` indicates a missing entry in the T004 proxy map — fix it in `vite.config.js` before continuing.
- [ ] T010 [US2] With `npm start` running, edit any file under `/Users/nick/code/drerings/src/` (e.g. add a benign whitespace change to `src/index.ts`) and confirm in the browser the SPA reloads via HMR in under 1 second and the Netlify Functions log stream shows no restart (SC-004). Revert the edit.

**Checkpoint**: One command runs the whole stack with HMR.

---

## Phase 5: User Story 3 - SPA routing and Vite internals (Priority: P2)

**Goal**: Deep-route refresh in dev returns the SPA shell; Vite's internal module URLs are not rewritten to `index.html`.

**Independent Test**: With `npm start` running, navigate to `http://127.0.0.1:8888/account` and hit refresh — the route renders. In DevTools Network panel, confirm `/src/index.ts`, `/@vite/client`, etc. are served as `Content-Type: application/javascript`.

### Verification for User Story 3

- [ ] T011 [US3] With `npm start` running, navigate the browser to `http://127.0.0.1:8888/account` (or any non-root SPA route) and hit Refresh. Confirm the SPA shell loads and the client-side router renders the route (SC-003, FR-007). A 404 here indicates Vite's SPA history fallback is not working — most likely because the T004 proxy was scoped to `/` instead of `/api` + `/.well-known/...`.
- [ ] T012 [US3] In the same browser session, open DevTools → Network and confirm `/src/index.ts`, `/@vite/client`, and any `/node_modules/*` requests are returned with `Content-Type: application/javascript` (or appropriate JS MIME), NOT HTML (FR-008). If any of these come back as `index.html`, the proxy `match` is too broad.

**Checkpoint**: Refresh on any client-side route works; Vite internals are intact.

---

## Phase 6: User Story 4 - Production unchanged (Priority: P3)

**Goal**: Production build artifacts, redirect table, security headers, and OAuth client metadata semantics on the deployed origin are byte-equivalent (or semantically equivalent) to the pre-change baseline.

**Independent Test**: `git diff main -- netlify.toml` shows only the `[dev]` block removed; `npm run build` produces the same artifacts as a baseline build from `main`; a preview deploy completes OAuth sign-in as it did before.

### Implementation for User Story 4

- [ ] T013 [US4] Remove the `[dev]` block (lines 129–131 today) from `/Users/nick/code/drerings/netlify.toml`. Do NOT touch `[build]`, `[functions]`, any `[[redirects]]`, any `[[headers]]`, any `[[context.*]]`, or any other section (FR-009, research.md Decision 4).

### Verification for User Story 4

- [ ] T014 [US4] Run `git diff main -- /Users/nick/code/drerings/netlify.toml` and confirm the diff contains ONLY the removal of the `[dev]` block (3 lines + the blank line separator) and nothing else (SC-005).
- [ ] T015 [US4] Run `npm run build` and confirm it completes without error and produces output under `/Users/nick/code/drerings/public/`. Spot-check that the artifact contents are functionally equivalent to a pre-change baseline (same entry points, same asset references).

**Checkpoint**: Production behavior is provably unchanged.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation alignment and full regression sweep.

- [ ] T016 [P] Update the "Develop" / "Local development" section of `/Users/nick/code/drerings/README.md` to describe the two-port layout, the `npm start` command, why to browse `http://127.0.0.1:8888` (and not `localhost`), and the override recipes from `quickstart.md` (Vite port override + `PUBLIC_URL`, functions port override). Remove any prior text warning against running `vite` directly (FR-011, research.md Decision 5).
- [ ] T017 [P] Update the "Local development" section of `/Users/nick/code/drerings/CLAUDE.md` to match T016: invert the existing warning ("Do NOT run `vite`…") to instead instruct future contributors that `vite` is now the dev front door via `npm start`, with the same port-collision override notes.
- [ ] T018 Run `npm test && npm run lint` in `/Users/nick/code/drerings/` and confirm both pass cleanly. No new tests are added by this work; the existing suites must remain green.
- [ ] T019 Run `npm run test:e2e` (vitest) in `/Users/nick/code/drerings/` and confirm the suite passes. If the suite assumes `netlify dev` on 8888 implicitly, that assumption no longer holds for any test that starts a dev process — adjust only the test infrastructure, not test expectations.
- [ ] T020 Execute the full quickstart.md walkthrough one final time end-to-end against `npm start` from a clean shell: US1 (OAuth sign-in to authenticated route), US2 (both ports up + `/api/whoami` 401 within 10s), US3 (refresh on `/account` + `/src/*` served as JS), US4 (`git diff main -- netlify.toml` clean, `npm run build` succeeds). All four MUST pass.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 has no dependencies.
- **Foundational (Phase 2)**: T002, T003, T004 require Setup. T003 and T004 both touch `vite.config.js` so they MUST run sequentially (T003 before T004). T002 (package.json) is independent of T003/T004 and could be done in parallel.
- **US1 (Phase 3)**: Requires Phase 2 complete (the proxy must exist before `redirect_uri` of `:8888` works).
- **US2 (Phase 4)**: Requires Phase 2 complete. Independent of US1.
- **US3 (Phase 5)**: Requires Phase 2 complete (specifically T004's narrow proxy scope). Independent of US1 and US2.
- **US4 (Phase 6)**: Independent of all other user stories — touches `netlify.toml` only. Can run any time after Setup, but it is gated to its own phase to keep the prod-unchanged commit reviewable in isolation.
- **Polish (Phase 7)**: Requires all four user stories verified.

### User Story Dependencies

- **US1 (P1)**: Functionally depends on Phase 2 (Vite must own 8888 + proxy must route `/.well-known/...`). Otherwise no cross-story dependencies.
- **US2 (P2)**: Pure verification of Phase 2 work. No cross-story dependencies.
- **US3 (P2)**: Pure verification of Phase 2's proxy scoping. No cross-story dependencies.
- **US4 (P3)**: Independent — touches `netlify.toml` only, which no other story touches.

### Within Each User Story

- Implementation tasks (T005, T013) before verification tasks (T006–T007, T014–T015).
- Verification tasks within a single story can run sequentially; they exercise different paths but share the running `npm start` process.

### Parallel Opportunities

- **In Phase 2**: T002 (`package.json`) is parallelizable with T003 (`vite.config.js` server block). T003 and T004 both touch `vite.config.js` so they are sequential.
- **In Phase 7**: T016 (`README.md`) and T017 (`CLAUDE.md`) touch different files and are parallelizable.
- **Across user stories**: Once Phase 2 is complete, US1, US2, US3, US4 verification phases can run in parallel if multiple developers are available. In a single-developer setting they're naturally sequential because they share the dev process.

---

## Parallel Example: Phase 2

```bash
# T002 and T003 touch different files, so they can run in parallel.
# T004 must wait for T003 (same file).

Task: "T002 — replace npm start script in package.json"
Task: "T003 — set server.port/strictPort/host in vite.config.js"
# then:
Task: "T004 — add server.proxy map to vite.config.js"
```

## Parallel Example: Phase 7

```bash
# T016 and T017 touch different docs.
Task: "T016 — update README.md Develop section"
Task: "T017 — update CLAUDE.md Local development section"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. T001 (Setup).
2. T002, T003, T004 (Foundational — two-port layout + proxy map).
3. T005, T006, T007 (US1 — OAuth fix + verification).
4. **STOP and VALIDATE**: Manual OAuth walkthrough per quickstart.md US1. This is the headline bug fix and the most user-visible improvement.

### Incremental Delivery

1. Setup + Foundational + US1 → MVP shippable (the OAuth blank-page bug is fixed).
2. Verify US2 (single-command + HMR) — likely already passing once Phase 2 lands.
3. Verify US3 (SPA routing + Vite internals) — likely already passing once T004 is scoped narrowly.
4. Apply US4 (`netlify.toml [dev]` removal) and verify prod-unchanged guarantees.
5. Polish: docs (T016, T017) + full test sweep (T018, T019) + final quickstart pass (T020).

### Single-Developer Sequencing (recommended)

This change is small enough that one engineer should drive it
straight through: T001 → T002 → T003 → T004 → T005 → run quickstart
US1 walkthrough → T013 → run quickstart US4 → T016 + T017 → T018 +
T019 → T020. Total touch surface: 6 files.

---

## Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps task to specific user story for traceability.
- This feature has no new automated tests; acceptance is by manual quickstart walkthrough plus the existing `npm test` / `npm run test:e2e` regression suite continuing to pass.
- No production code under `src/**`, `netlify/functions/**`, or `netlify/database/migrations/**` is touched. If a task ever needs to touch one of those directories, that is a red flag — reread plan.md "Project Structure" before proceeding.
- Stop at any checkpoint to validate the story independently against quickstart.md.
- Avoid: re-introducing the `[dev]` block in `netlify.toml`, broadening the Vite proxy to `/` (would steal `/src/*`), or relaxing `strictPort: true` (would let Vite drift off 8888 and silently break OAuth).
