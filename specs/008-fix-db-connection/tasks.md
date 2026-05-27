---
description: "Task list for Fix Missing Database Connection in Local Dev (revision 2 — @netlify/vite-plugin)"
---

# Tasks: Fix Missing Database Connection in Local Dev

**Input**: Design documents from `/specs/008-fix-db-connection/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md
**Revision**: 2 — replaces the preflight + `.env` task list with the
`@netlify/vite-plugin` task list. See research.md Decision 2.

**Tests**: No automated test tasks. The spec explicitly designates
"start the stack and observe behavior" as verification (plan.md
Technical Context → Testing). Verification is hand-driven via the
quickstart walkthrough; the existing `npm run lint`, `npm test`, and
`npm run test:e2e` suites must continue to pass but no new test code
is added by this work.

**Organization**: Tasks are grouped by user story so each can be
delivered and verified independently. US1 alone is shippable as the
fix; US2 and US3 add documentation and a no-regression audit.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are absolute repo-relative

## Path Conventions

Single-project web app, existing layout (plan.md). The change
touches `package.json`, `package-lock.json`, `vite.config.js`,
`README.md`, and `CLAUDE.md`. Nothing under `netlify/functions/`,
`netlify/lib/`, `netlify/database/migrations/`, or `netlify.toml`
is modified. No new files are created outside the spec directory.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm `.netlify/` is gitignored before any further task
causes `.netlify/db/` to be created, so PGlite state never lands in
a commit.

- [X] T001 Confirm `.netlify` is listed in `/Users/nick/code/drerings/.gitignore` and that `git check-ignore .netlify` prints `.netlify`. This prevents `.netlify/db/` (auto-provisioned by `@netlify/vite-plugin` on first start) from being staged. No change required if already true.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Install the single new dependency that US1 wires into
`vite.config.js` and that US2's docs reference by name.

**CRITICAL**: T002 must complete before US1's `vite.config.js` edit
can resolve the `@netlify/vite-plugin` import, and before US2's docs
describe the plugin by name.

- [X] T002 `npm install --save-dev @netlify/vite-plugin@^2.12.6` from `/Users/nick/code/drerings`. This adds one entry to `devDependencies` in `package.json` and updates `package-lock.json`. Do NOT use `--save` (the plugin is dev-only, FR-008/SC-005 prohibit shipping it). Verify with `node -p "require('./package.json').devDependencies['@netlify/vite-plugin']"`.

**Checkpoint**: `@netlify/vite-plugin` is resolvable via
`import netlify from '@netlify/vite-plugin'`.

---

## Phase 3: User Story 1 - Developer can complete OAuth sign-in in local dev without database crash (Priority: P1) — MVP

**Goal**: A developer runs `npm start` and completes OAuth sign-in
without seeing `MissingDatabaseConnectionError`.

**Independent Test**: From a clean checkout, run `npm ci` then
`npm start`, browse to `http://127.0.0.1:8888`, click "Sign in",
enter a real Bluesky handle. The network panel shows
`GET /api/auth-login?handle=...` returning **302** with a
`Location` header pointing at the user's PDS. The browser lands on
the PDS consent screen. No `MissingDatabaseConnectionError` page
appears.

### Implementation for User Story 1

- [X] T003 [US1] Edit `/Users/nick/code/drerings/vite.config.js`: add `import netlify from '@netlify/vite-plugin'` at the top of the import block and register `netlify()` as the FIRST element in the `plugins` array (before `preact(...)`). Plugin order matters — see contracts/README.md "Vite plugin composition" — the netlify middleware must mount before any other plugin's middleware that might intercept `/api/*`.

- [X] T004 [US1] In the same edit pass on `/Users/nick/code/drerings/vite.config.js`, REMOVE the `server.proxy` block (the two entries targeting `http://127.0.0.1:9999`). With `netlify functions:serve` no longer running in `npm start`, the proxy targets a port nothing is bound to; the plugin's middleware now handles `/api/*` and `/.well-known/*` directly. Keep `port: 8888`, `strictPort: true`, and `host: true`. Update the inline comment above `server:` from the spec-007 two-process description to a single-line note that Vite is the only dev process and the netlify plugin handles function routing.

- [X] T005 [US1] Edit the `"start"` script in `/Users/nick/code/drerings/package.json` from `"concurrently --kill-others \"npx netlify functions:serve --port=9999\" \"npx vite\""` to `"vite"`. The script becomes a single command. Do NOT remove `concurrently` from `devDependencies` in this task — `npm uninstall concurrently` is a follow-up cleanup, not part of the spec-008 fix.

- [X] T006 [US1] Manually verify the independent test for US1: run `npm start` and confirm the Vite logger prints `Netlify Environment loaded` and lists `database` among the emulated features. Then browse to `http://127.0.0.1:8888`, initiate OAuth sign-in with a real Bluesky handle, and confirm `/api/auth-login?handle=...` returns **302** (not 500, not the `MissingDatabaseConnectionError` crash page). Repeat 10 consecutive times to satisfy SC-001. Also confirm a second DB-backed endpoint (e.g. `GET /api/whoami` after sign-in completes) returns a normal business-logic response, satisfying FR-011 / SC-003 by demonstrating the fix is shared rather than per-handler. (If migrations have not been applied to `.netlify/db/`, the second endpoint will surface `relation "users" does not exist` — run `npx netlify db migrations apply` then re-test. The 302 from `/api/auth-login` does not depend on user schema; it only touches `rate_limit_buckets`, which migration 0017 creates.)

**Checkpoint**: US1 is independently shippable. The fix is complete
for any developer with `npm ci` run. US2 and US3 may proceed
in parallel from here.

---

## Phase 4: User Story 2 - The dev stack documents its database requirement up front (Priority: P2)

**Goal**: A new contributor reading `README.md` and `CLAUDE.md` end
to end learns, before they hit a runtime crash, that the dev stack
auto-provisions a local Netlify Database, where it lives on disk,
and how to apply the project's migrations to it.

**Independent Test**: Read `README.md` and `CLAUDE.md` linearly from
the top. Both must describe (a) that `npm start` runs a single
`vite` process with `@netlify/vite-plugin` mounted, (b) that the
plugin provisions a local Postgres in `.netlify/db/` and exposes it
to the functions runtime as `NETLIFY_DB_URL` automatically, (c) the
`npx netlify db migrations apply` step a fresh contributor needs to
run once, and (d) the 127.0.0.1-not-localhost atproto OAuth note
(unchanged from spec 007, still applies). From a clean checkout,
following the documented steps must produce a working
`/api/auth-login` on the first attempt under 5 minutes (SC-002).

### Implementation for User Story 2

- [X] T007 [P] [US2] Rewrite the "Develop" section of `/Users/nick/code/drerings/README.md`. Replace the existing two-process description (Vite + `netlify functions:serve` + proxy plumbing + port-override notes) with the single-process description: `npm start` runs `vite`; `@netlify/vite-plugin` emulates Functions, Edge Functions, Redirects, Headers, Blobs, and a local Netlify Database; the local DB lives in `.netlify/db/` (gitignored, per-developer); apply migrations once with `npx netlify db migrations apply`; browse to `http://127.0.0.1:8888`. Keep (or rewrite) the existing 127.0.0.1-not-localhost note for atproto OAuth — it still applies. Remove the spec-007-specific guidance about overriding the functions port and the `404 "Function not found"` debugging tip referencing `vite.config.js` proxy drift — both are no longer relevant. Do NOT add a sample `.env` line for the database (none is needed; one would be misleading).

- [X] T008 [P] [US2] Rewrite the "Local development" section of `/Users/nick/code/drerings/CLAUDE.md` to mirror the README guidance from T007 in the canonical place an AI assistant reads project context. Same four required points (single-process via `npm start` → `vite`; `@netlify/vite-plugin` provides functions + local DB; `.netlify/db/` for PGlite state + `npx netlify db migrations apply`; 127.0.0.1-not-localhost for atproto OAuth). Remove the "Don't re-introduce `netlify dev`" sentence — see research.md Decision 6 for why it no longer applies. Remove the proxy-mirroring paragraph. Keep the `strictPort: true` and PUBLIC_URL guidance for port overrides — those still apply to Vite directly. Update the Recent Changes / Active Technologies header so `008-fix-db-connection` is reflected.

**Checkpoint**: US2 is independently shippable. A fresh contributor
following README → CLAUDE.md reaches a working stack without
reading source, commit history, or external Netlify docs.

---

## Phase 5: User Story 3 - Production deployment is unaffected (Priority: P3)

**Goal**: Maintainers confirm by audit that this change reaches zero
files that affect the deployed Functions bundle, the Netlify UI
configuration, or end-user behavior in deployed environments.

**Independent Test**: Run `git diff main...008-fix-db-connection
--stat` and confirm the changed paths are limited to the set
enumerated below. Deploy the branch to a Netlify preview and confirm
an authenticated flow works identically to a control deploy from
`main`, with no new env vars required in the Netlify UI (SC-005).

### Implementation for User Story 3

- [X] T009 [US3] Audit `git diff main...008-fix-db-connection --stat` and confirm the changed file set is a subset of: `package.json`, `package-lock.json`, `vite.config.js`, `README.md`, `CLAUDE.md`, `specs/008-fix-db-connection/**`. Specifically confirm zero changes under `netlify/functions/**`, `netlify/lib/**`, `netlify/database/migrations/**`, `netlify.toml`, and any file already shipped into the deployed Functions bundle (FR-008, FR-011, SC-005). If any unexpected path appears, stop and reconcile — do NOT relax this constraint.

- [X] T010 [US3] Confirm `@netlify/vite-plugin` is referenced only from `vite.config.js` and `package.json` / `package-lock.json` — `grep -r "@netlify/vite-plugin" netlify/ src/ test/` should return zero matches. This ensures the plugin cannot be transitively included in the deployed Functions bundle or the SPA bundle (FR-008, FR-010).

**Checkpoint**: US3 verified by audit. Production / preview /
branch deploys are inert under this change.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Confirm existing CI gates and the quickstart walkthrough
still pass end to end before the branch lands.

- [X] T011 [P] Run `npm run lint` from `/Users/nick/code/drerings` and confirm zero new errors or warnings introduced by the `vite.config.js` edit, the `package.json` start-script change, or the README / CLAUDE.md doc edits. (The new code in `vite.config.js` is a single import + one plugin entry — ESLint will lint it under the existing `./**/*.{ts,js}` glob.)

- [X] T012 [P] Run `npm test` and `npm run test:e2e` from `/Users/nick/code/drerings` and confirm both suites pass with the same baseline as `main`. No new test code is expected (verification is the manual quickstart walkthrough); these runs exist to confirm the `vite.config.js` and `package.json` edits did not regress the existing suites.

- [X] T013 Walk the quickstart end to end against a fresh shell using `/Users/nick/code/drerings/specs/008-fix-db-connection/quickstart.md` as the script. Exercise the "Failure modes and how to read them" table by temporarily renaming `.netlify/db/` aside (`mv .netlify/db .netlify/db.bak`), restarting `npm start`, confirming a new fresh PGlite is provisioned and `Netlify Environment loaded` logs, then `npx netlify db migrations apply`, then run `/api/whoami` and confirm a normal response. Restore the backup if desired (`rm -rf .netlify/db && mv .netlify/db.bak .netlify/db`). This covers FR-003, FR-004, and SC-004.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** — no dependencies; run first.
- **Foundational (Phase 2)** — depends on Setup; BLOCKS all user stories.
- **User Story 1 (Phase 3)** — depends on Foundational (T002); MVP.
- **User Story 2 (Phase 4)** — depends on Foundational (T002, so docs can name the dependency accurately); references the plugin by name. Can run in parallel with US1 since it touches different files (`README.md`, `CLAUDE.md`).
- **User Story 3 (Phase 5)** — depends on US1 and US2 being committed so the audit (T009) has the full diff to inspect.
- **Polish (Phase 6)** — depends on US1 + US2 implementation complete; T013 also exercises the plugin's failure modes from T002+T003.

### Within Each User Story

- US1: T003/T004 are a single edit pass on `vite.config.js`; T005 is the `package.json` edit. T006 is verification and depends on T003+T004+T005.
- US2: T007 and T008 are independent (different files). Both can run in parallel.
- US3: T009 depends on US1 and US2 commits. T010 is a static grep and can run any time after T002.

### Parallel Opportunities

- T007 [P] and T008 [P] can run concurrently.
- T011 [P] and T012 [P] can run concurrently in Phase 6.
- US1 and US2 can be staffed in parallel after T002 lands.

---

## Parallel Example: User Story 2

```bash
# Update README and CLAUDE.md docs concurrently (different files):
Task: "Rewrite README.md Develop section for @netlify/vite-plugin (T007)"
Task: "Rewrite CLAUDE.md Local development section for @netlify/vite-plugin (T008)"
```

## Parallel Example: Polish

```bash
# Run lint and tests concurrently:
Task: "npm run lint (T011)"
Task: "npm test && npm run test:e2e (T012)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (T001).
2. Complete Phase 2 (T002) — `@netlify/vite-plugin` installed.
3. Complete Phase 3 (T003, T004, T005, T006) — fix verified by hand.
4. STOP and VALIDATE: `npm start` starts a single Vite process with `database` in the emulated-features log; `/api/auth-login` returns 302; `npx netlify db migrations apply` followed by `/api/whoami` returns a normal response.
5. Ship as-is if docs and audit work will land in a follow-up.

### Incremental Delivery

1. Setup + Foundational → plugin installed.
2. + US1 → developer-blocking bug fixed (MVP, ships independently).
3. + US2 → new contributors get up-front guidance.
4. + US3 → no-regression audit signed off.
5. + Polish → lint, tests, and quickstart walkthrough green.

### Single-Developer Strategy

The change is small enough (two-line `vite.config.js` edit, one-line
`package.json` edit, two doc rewrites) that one developer can
complete all six phases in a single session. Use the parallel
markers in Phase 4 and Phase 6 to overlap independent edits and CI
runs.

---

## Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps each task to its user story for traceability.
- US1 alone is shippable. US2 and US3 add documentation and an audit gate.
- No new automated tests by design — verification is the manual quickstart walkthrough plus existing CI gates.
- Commit after each task or logical group. Suggested grouping: T001+T002 (scaffold), T003+T004+T005 (US1 fix), T006 (US1 verify), T007+T008 (US2 docs), T009+T010 (US3 audit), T011–T013 (polish).
- Do NOT add `NETLIFY_DB_URL` to any tracked file — the plugin's PGlite provisioner generates the value in-process.
- Do NOT touch `netlify/functions/**`, `netlify/lib/**`, `netlify.toml`, or `netlify/database/migrations/**` — those changes would violate FR-001, FR-008, and FR-011.
- Removing `concurrently` from `devDependencies` is a follow-up cleanup, not part of this spec.
