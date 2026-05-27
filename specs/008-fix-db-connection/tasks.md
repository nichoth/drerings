---
description: "Task list for Fix Missing Database Connection in Local Dev"
---

# Tasks: Fix Missing Database Connection in Local Dev

**Input**: Design documents from `/specs/008-fix-db-connection/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

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
touches `.env` (gitignored), `package.json`, one new file under
`scripts/`, `README.md`, and `CLAUDE.md`. Nothing under
`netlify/functions/` or `netlify/lib/` is modified.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm preconditions so the fix can be staged without
risk of committing a connection string.

- [ ] T001 Confirm `.env` is listed in `/Users/nick/code/drerings/.gitignore` and remains untracked (`git check-ignore .env` should print `.env`; `git ls-files .env` should print nothing). No change required if both are already true — this gate exists to prevent FR-006 / SC-006 regressions before any further task adds content to `.env`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the single shared artifact that US1 wires into
`npm start` and that US2's docs reference by name.

**CRITICAL**: T002 must exist before US1's `npm start` edit lands
(US1 invokes this script) and before US2's docs describe its
behavior. US3's audit also checks that this file is dev-only.

- [ ] T002 Create `/Users/nick/code/drerings/scripts/check-dev-env.mjs`. ESM, no dependencies. Reads `process.env.NETLIFY_DB_URL`. If present and non-empty, exit `0` silently. If missing or empty, write a single human-readable message to `stderr` (must name the variable `NETLIFY_DB_URL`, the file to set it in — `.env`, and a pointer to the README "Develop" section) and exit `1`. Do NOT validate URL format, host reachability, or schema state — those distinctions are intentionally left to surface from Postgres at first use per FR-004 and the failure-modes table in `specs/008-fix-db-connection/quickstart.md`. Do NOT import this script from any function bundle (contracts/README.md "Preflight contract").

**Checkpoint**: Preflight script exists and exits 0/1 correctly on
manual invocation (`node --env-file=.env scripts/check-dev-env.mjs`).

---

## Phase 3: User Story 1 - Developer can complete OAuth sign-in in local dev without database crash (Priority: P1) — MVP

**Goal**: A developer on a correctly configured machine runs the
documented start command and completes OAuth sign-in without seeing
`MissingDatabaseConnectionError`.

**Independent Test**: Start the dev stack via `npm start`, browse to
`http://127.0.0.1:8888`, click "Sign in", enter a real Bluesky
handle. The network panel shows `GET /api/auth-login?handle=...`
returning **302** with a `Location` header pointing at the user's
PDS. The browser lands on the PDS consent screen. No
`MissingDatabaseConnectionError` page appears.

### Implementation for User Story 1

- [ ] T003 [US1] On the developer's local machine only, add a line `NETLIFY_DB_URL=<your-postgres-connection-string>` to `/Users/nick/code/drerings/.env`. Place it adjacent to the existing `RESEND_API_KEY`, `AUTUMN_API_KEY`, `SESSION_SECRET` lines. Single line, no quoting (the dotenv parser handles passwords with shell-special characters per quickstart.md "One-time setup" step 2). This is a per-developer action; the file is gitignored (verified in T001) and MUST NOT be staged or committed (FR-006).

- [ ] T004 [US1] Update the `"start"` script in `/Users/nick/code/drerings/package.json` to invoke the preflight before `concurrently`. New value: `"node --env-file=.env scripts/check-dev-env.mjs && concurrently --kill-others \"npx netlify functions:serve --port=9999\" \"npx vite\""`. Do NOT change the ports, the `--kill-others` flag, the order of the two child commands, or introduce any other dev front door — spec 007's two-process layout is authoritative (plan.md Constraints, CLAUDE.md "Local development").

- [ ] T005 [US1] Manually verify the independent test for US1: run `npm start`, browse to `http://127.0.0.1:8888`, initiate OAuth sign-in with a real Bluesky handle, and confirm `/api/auth-login?handle=...` returns **302** (not 500, not the `MissingDatabaseConnectionError` crash page). Repeat 10 consecutive times to satisfy SC-001. Also confirm a second DB-backed endpoint (e.g. `GET /api/whoami` after sign-in completes) returns a normal business-logic response, satisfying FR-011 / SC-003 by demonstrating the fix is shared rather than per-handler.

**Checkpoint**: US1 is independently shippable. The fix is complete
for any developer with a configured `.env`. US2 and US3 may proceed
in parallel from here.

---

## Phase 4: User Story 2 - The dev stack documents its database requirement up front (Priority: P2)

**Goal**: A new contributor reading `README.md` and `CLAUDE.md` end
to end learns, before they hit a runtime crash, that the functions
process needs `NETLIFY_DB_URL` in local dev and how to provide it.

**Independent Test**: Read `README.md` and `CLAUDE.md` linearly from
the top. Both must describe (a) that the functions process needs a
database connection in local dev, (b) the exact variable
(`NETLIFY_DB_URL`) and where it goes (`.env`), and (c) where a fresh
contributor obtains a value. From a clean checkout, following the
documented steps must produce a working `/api/auth-login` on the
first attempt under 5 minutes (SC-002).

### Implementation for User Story 2

- [ ] T006 [P] [US2] Update the "Develop" / "Local development" section of `/Users/nick/code/drerings/README.md`. Add a short paragraph (3–5 sentences) immediately adjacent to the `npm start` instructions stating that the functions process needs a Postgres connection in local dev, that the value lives in `.env` as `NETLIFY_DB_URL=...`, and the three acceptable sources for the value (Netlify Database dashboard, local Postgres with project migrations applied, teammate-shared dev URL — per quickstart.md "Prerequisites"). Mention that the `npm start` preflight will fail loud with a single message if the variable is missing (do NOT paste the preflight's error text verbatim — point at the script). Do NOT include a sample connection string or any real credentials (FR-010, SC-006).

- [ ] T007 [P] [US2] Update the "Local development" section of `/Users/nick/code/drerings/CLAUDE.md` to mirror the README guidance from T006 in the same canonical place an AI assistant reads project context. Same three required points (functions process needs the DB connection in local dev; variable is `NETLIFY_DB_URL` in `.env`; acceptable sources). Keep the existing 127.0.0.1 / loopback / `[dev]`-block guidance intact — only add the new paragraph; do not restructure or remove the existing content.

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

- [ ] T008 [US3] Audit `git diff main...008-fix-db-connection --stat` and confirm the changed file set is a subset of: `.env` (must NOT appear — gitignored), `package.json`, `scripts/check-dev-env.mjs`, `README.md`, `CLAUDE.md`, `specs/008-fix-db-connection/**`. Specifically confirm zero changes under `netlify/functions/**`, `netlify/lib/**`, `netlify/database/migrations/**`, `netlify.toml`, `vite.config.js`, or any file already shipped into the deployed Functions bundle (FR-008, FR-011, SC-005). If any unexpected path appears, stop and reconcile — do NOT relax this constraint.

- [ ] T009 [US3] Confirm `scripts/check-dev-env.mjs` is not referenced from any file under `netlify/functions/**`, `netlify/lib/**`, `netlify.toml`, or `vite.config.js` — `grep -r 'check-dev-env' netlify/ netlify.toml vite.config.js` should return zero matches. This satisfies the contracts/README.md "Preflight contract" constraint that the script has no consumers other than the `npm start` shell pipeline and ensures it never ships in the deployed bundle.

**Checkpoint**: US3 verified by audit. Production / preview /
branch deploys are inert under this change.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Confirm existing CI gates and the quickstart walkthrough
still pass end to end before the branch lands.

- [ ] T010 [P] Run `npm run lint` from `/Users/nick/code/drerings` and confirm zero new errors or warnings introduced by `scripts/check-dev-env.mjs`, the `package.json` start-script change, or the README / CLAUDE.md doc edits. If the new `.mjs` file is outside the existing ESLint glob (`./**/*.{ts,js}`), do NOT widen the lint config to include it — this would violate the global "NEVER change eslint settings" rule. The script being un-linted is acceptable for a 30-line dev-only preflight.

- [ ] T011 [P] Run `npm test` and `npm run test:e2e` from `/Users/nick/code/drerings` and confirm both suites pass with the same baseline as `main`. No new test code is expected (verification is the manual quickstart walkthrough); these runs exist to confirm the package.json start-script edit and the new preflight script did not regress the existing suites.

- [ ] T012 Walk the quickstart end to end against a fresh shell using `/Users/nick/code/drerings/specs/008-fix-db-connection/quickstart.md` as the script. Execute the "Failure modes and how to read them" table by temporarily removing the `NETLIFY_DB_URL` line from `.env` and confirming the preflight prints the single actionable message and exits 1 — then restore the line and confirm `npm start` succeeds. This covers FR-003, FR-004, and SC-004 (actionable message within 5s of startup).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** — no dependencies; run first.
- **Foundational (Phase 2)** — depends on Setup; BLOCKS all user stories.
- **User Story 1 (Phase 3)** — depends on Foundational (T002); MVP.
- **User Story 2 (Phase 4)** — depends on Foundational (T002); references the preflight by name. Can run in parallel with US1 since it touches different files (`README.md`, `CLAUDE.md`).
- **User Story 3 (Phase 5)** — depends on US1 and US2 being committed so the audit (T008) has the full diff to inspect.
- **Polish (Phase 6)** — depends on US1 + US2 implementation complete; T012 also exercises T002's failure path.

### Within Each User Story

- US1: T003 and T004 are independent (different files: `.env` vs `package.json`). T005 is verification and depends on both.
- US2: T006 and T007 are independent (different files). Both can run in parallel.
- US3: T008 depends on US1 and US2 commits. T009 is a static grep and can run any time after T002.

### Parallel Opportunities

- T006 [P] and T007 [P] can run concurrently.
- T010 [P] and T011 [P] can run concurrently in Phase 6.
- US1 and US2 can be staffed in parallel after T002 lands.

---

## Parallel Example: User Story 2

```bash
# Update README and CLAUDE.md docs concurrently (different files):
Task: "Update README.md 'Develop' section with NETLIFY_DB_URL guidance (T006)"
Task: "Update CLAUDE.md 'Local development' section with NETLIFY_DB_URL guidance (T007)"
```

## Parallel Example: Polish

```bash
# Run lint and tests concurrently:
Task: "npm run lint (T010)"
Task: "npm test && npm run test:e2e (T011)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (T001).
2. Complete Phase 2 (T002) — preflight script exists.
3. Complete Phase 3 (T003, T004, T005) — fix verified by hand.
4. STOP and VALIDATE: dev stack starts, `/api/auth-login` returns 302, downstream DB-backed endpoints respond normally.
5. Ship as-is if docs and audit work will land in a follow-up.

### Incremental Delivery

1. Setup + Foundational → preflight scaffold ready.
2. + US1 → developer-blocking bug fixed (MVP, ships independently).
3. + US2 → new contributors get up-front guidance.
4. + US3 → no-regression audit signed off.
5. + Polish → lint, tests, and quickstart walkthrough green.

### Single-Developer Strategy

The change is small enough (one new file, one `package.json` edit,
two doc edits) that one developer can complete all six phases in a
single session. Use the parallel markers in Phase 4 and Phase 6 to
overlap independent edits and CI runs.

---

## Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps each task to its user story for traceability.
- US1 alone is shippable. US2 and US3 add documentation and an audit gate.
- No new automated tests by design — verification is the manual quickstart walkthrough plus existing CI gates.
- Commit after each task or logical group. Suggested grouping: T001+T002 (scaffold), T003+T004 (US1 fix), T005 (US1 verify), T006+T007 (US2 docs), T008+T009 (US3 audit), T010–T012 (polish).
- Do NOT add `NETLIFY_DB_URL` to any tracked file — every appearance must be in `.env` or in the developer's shell.
- Do NOT relax ESLint config to include `scripts/check-dev-env.mjs` (global rule "NEVER change eslint settings").
- Do NOT touch `netlify/functions/**`, `netlify/lib/**`, or `netlify.toml` — those changes would violate FR-001, FR-008, and FR-011.
