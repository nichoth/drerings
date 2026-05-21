# Tasks: atproto Sign-In 404 Recurrence (`/api/auth/login`)

**Input**: Design documents from `/specs/006-fix-auth-login-404/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/routing.md, quickstart.md

**Tests**: Explicitly requested by spec FR-009 — an automated test
MUST detect the "handler not reachable for `/api/auth/login`" defect
class so the bug cannot resurface a third time without CI noticing.
The plan defines exactly one new test
(`test/netlify-toml-routing.test.ts`); no other tests are added.

**Organization**: This feature has a single P1 user story
("Sign-in works on every fresh dev-server start"). All implementation
tasks roll up to that story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps task to the spec's user story (US1 only here)
- Paths are repository-root absolute where ambiguous

## Path Conventions

This is the existing drerings web app:
- Preact SPA in `src/`
- Netlify Functions in `netlify/functions/` (flat layout from 005)
- Domain logic in `netlify/lib/`
- Tapout-bundled tests in `test/` (registered via `test/index.ts`)

No new directories are introduced. All file paths below are relative
to the repository root (`/Users/nick/code/drerings/`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project is already initialized. No setup tasks.

(Intentionally empty — `netlify-cli` is already in `devDependencies`
per plan.md §Technical Context; no new tooling is required.)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None. This fix is a routing/dev-workflow consolidation
with one new static-analysis test. Nothing must complete before the
US1 work begins.

(Intentionally empty — no schema, no shared modules, no infra.)

---

## Phase 3: User Story 1 — Sign-in works on every fresh dev-server start (Priority: P1) 🎯 MVP

**Goal**: `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`,
and `/.well-known/oauth-client-metadata.json` reach their handlers on
every request in local dev (and continue to in deployed envs),
including the very first request after a cold `npm start`. The fix
must be durable across the common local-dev workflows enumerated in
FR-008.

**Independent Test**: From a clean checkout of this branch, run
`npm install` then `npm start` in a terminal. Without warming up,
open a fresh-profile browser to
`http://127.0.0.1:8888/api/auth/login?handle=<a-real-handle>` and
observe a 302 redirect to the PDS authorize URL — not the bare text
`Function not found...`. Then run `npm test` and confirm the new
`netlify-toml-routing.test.ts` passes (and that breaking the redirect
table makes it fail — see quickstart.md "To prove the test is
load-bearing").

### Tests for User Story 1 (FR-009 — REQUIRED) ⚠️

> **NOTE**: Write the static-analysis test FIRST. On the current
> branch state (post-005), the test SHOULD PASS — every redirect
> already resolves to a real flat function file. To prove the test
> exercises the defect class, run the "Temporarily break the redirect
> target" trick from quickstart.md (T003 below) and confirm the test
> fails, then revert.

- [ ] T001 [P] [US1] Create
      `test/netlify-toml-routing.test.ts`. Parse
      `netlify.toml` for every `[[redirects]]` block whose `to`
      matches `/.netlify/functions/<name>` (with optional `/:splat`
      suffix), and assert that `netlify/functions/<name>.ts` exists.
      Also assert the inverse: every file in
      `netlify/functions/*.ts` EXCEPT the exclusion list
      (`refund-expired-gifts.ts`, `verify-stamp-invariants.ts`) is
      referenced by at least one redirect. Use a regex over
      `netlify.toml` text (no TOML parser dependency) and Node's
      `fs.existsSync` / `fs.readdirSync`. Follow the project's
      TypeScript style (no space after `:`, 80-col, `tapzero`
      `test(name, async t => {...})` form matching existing test
      files like `test/us020-shares-precheck.test.ts`). Do not assert
      on response bodies or HTML (CLAUDE.md "no brittle tests" rule).

- [ ] T002 [US1] Register the new test in `test/index.ts` so it runs
      under `npm test` (add an `import './netlify-toml-routing.test'`
      line near the existing imports). Depends on T001.

- [ ] T003 [US1] Run `npm test` once unmodified to confirm the new
      test PASSES against the current `netlify.toml` and
      `netlify/functions/` layout. Then perform the load-bearing
      proof from quickstart.md: `sed -i.bak 's|auth-login|auth-broken
      |' netlify.toml && npm test` — expect the new test to FAIL.
      Restore with `mv netlify.toml.bak netlify.toml` and re-run
      `npm test` to confirm GREEN. Depends on T002.

### Implementation for User Story 1

- [ ] T004 [P] [US1] Edit `package.json` `scripts.start` to read
      `"start": "netlify dev"`. Remove the existing `concurrently`
      invocation entirely. Do NOT add flags — `netlify dev`
      auto-detects the Vite SPA, the functions directory, and
      `netlify.toml`. Leave every other script (`lint`, `build`,
      `test`, `test:e2e`, `start`-adjacent prepublish hooks)
      unchanged. Do NOT modify the `dependencies` or
      `devDependencies` blocks — `netlify-cli` ^23.4.3 is already
      present.

- [ ] T005 [P] [US1] Edit `vite.config.js` to remove the entire
      `server.proxy` block (the `proxy: { '/api': { ... } }` object).
      KEEP `port: 8888`, `host: true`, `open: true` on the
      `server` config so standalone `npx vite` still serves the SPA
      on the same port `netlify dev` uses. Do NOT touch `plugins`,
      `define`, `esbuild`, `publicDir`, `css`, or `build` blocks.

- [ ] T006 [P] [US1] Update `README.md` "Develop" section
      (currently `README.md:22-26`). Replace the bare `npm start`
      block with the snippet from research.md "Decision: documentation
      in README + `CLAUDE.md`":

      ```md
      ## Develop

      ```sh
      npm start
      ```

      This runs `netlify dev`, which serves the Preact SPA and
      Netlify Functions on `http://localhost:8888` and applies the
      `netlify.toml` redirect table just like the deployed
      environment. Do not run `vite` or `netlify functions:serve`
      directly — they bypass the redirect table and you will see
      "Function not found" on `/api/*`.
      ```

      The "why" sentence is what prevents the next recurrence — keep
      the warning text verbatim. Do NOT add emojis, do NOT touch the
      "Installability And Share Gate", "Deployment", or any other
      section.

- [ ] T007 [P] [US1] Add a one-line note to the project `CLAUDE.md`
      under a new "## Local development" heading (insert after the
      existing "## Commands" block, before "## Code Style"), pointing
      contributors at the README. Suggested text:

      ```md
      ## Local development

      Run `npm start` (which invokes `netlify dev` on port 8888) —
      see `README.md#develop` for why. Do NOT run `vite` or `netlify
      functions:serve` directly; both bypass the `netlify.toml`
      redirect table and produce a `Function not found` 404 on
      `/api/*`.
      ```

      Also bump the `Last updated:` date at the top of `CLAUDE.md`
      to `2026-05-21`. Do NOT touch any other section — the file is
      the project's durable context for future Claude sessions.

### Manual verification (quickstart.md)

- [ ] T008 [US1] Execute quickstart.md acceptance scenarios 1-7
      against this branch with a fresh browser profile:
      1. First request after `npm start` hits
         `/api/auth/login?handle=<valid>` and returns 302 (FR-005).
      2. Subsequent requests stay routed — 302/400/405/429 only, no
         "Function not found" (FR-001).
      3. PDS redirects back to `/api/auth/callback`, callback runs,
         `/api/whoami` returns the user (FR-002).
      4. `POST /api/auth/logout` returns its handler-defined response
         and clears the cookie (FR-003).
      5. `GET /.well-known/oauth-client-metadata.json` returns 200
         JSON with its cacheable `Cache-Control` opt-out preserved
         (FR-004).
      6. Stop and restart `npm start`; the FIRST request after
         restart still returns 302 (FR-008).
      7. Sample other endpoints (`/api/whoami`, `/api/stamps/lots`,
         `/api/stamps/transactions`, `POST /api/shares/precheck`) —
         each reaches its handler with no platform 404 (FR-007).

      Record any failure as a regression and resolve before moving
      on. Depends on T004, T005, T006.

**Checkpoint**: All FR-001 through FR-010 requirements satisfied.
US1 is independently testable via T003 (automated) plus T008
(manual). MVP-ready.

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Confirm no regression in unrelated test suites and the
fix lands cleanly.

- [ ] T009 [P] Run `npm test && npm run lint` end-to-end and confirm
      both pass. The new static-analysis test is in `npm test`; lint
      MUST pass on the new test file (80-col, no-space `:type`,
      ternary style per `~/.claude/CLAUDE.md`).

- [ ] T010 [P] Run `npm run test:e2e` (vitest) to confirm SC-005 —
      existing automated tests for unrelated endpoints (postcards,
      shares, billing, stamps, account, drawings, whoami) still
      pass.

- [ ] T011 Commit changes in one logical commit referencing the
      feature branch `006-fix-auth-login-404`. Do NOT amend prior
      commits; do NOT skip hooks. Suggested commit subject:
      `fix(dev): collapse /api/* routing into netlify.toml via
      netlify dev`. Include in the body: the root cause from
      research.md §"Why `/api/*/auth/login` 404s", the four file
      changes (package.json, vite.config.js, README.md,
      CLAUDE.md), and the new test file.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: empty.
- **Foundational (Phase 2)**: empty.
- **User Story 1 (Phase 3)**: starts immediately. This is the only
  user story.
- **Polish (Phase N)**: depends on Phase 3 completion (T011 also
  depends on T009 and T010 passing).

### Within User Story 1

- T001 → T002 → T003 (test file → register → run/verify load-bearing)
- T001, T004, T005, T006, T007 are **all different files** and can
  run in parallel.
- T002 depends on T001 (same conceptual file/registration pair).
- T003 depends on T002 (must register to run).
- T008 (manual quickstart) depends on T004 + T005 + T006 (the
  dev-workflow changes must be in place to see the fix).
- T008 does NOT depend on T001-T003 — the manual scenarios test the
  workflow swap, not the new automated test.

### Parallel Opportunities

```text
[T001] ──► [T002] ──► [T003]
   │
   ╰─ parallel with ─┐
                     │
[T004] ──┐           │
[T005] ──┼─► [T008] ─┴─► [T009][T010] ──► [T011]
[T006] ──┤
[T007] ──╯ (independent — CLAUDE.md note)
```

T001, T004, T005, T006, T007 are all `[P]` and can be opened in
parallel editors. T002 serializes immediately after T001. T009 and
T010 are independent verification commands and parallelize.

---

## Parallel Example: User Story 1 kickoff

```bash
# Open the file edits side-by-side; they touch five distinct files:
Task: "Create test/netlify-toml-routing.test.ts (T001)"
Task: "Update package.json scripts.start to 'netlify dev' (T004)"
Task: "Remove server.proxy from vite.config.js (T005)"
Task: "Rewrite README.md Develop section (T006)"
Task: "Add Local development section to CLAUDE.md (T007)"
```

Then serialize the verification chain:
T002 → T003 → T008 → T009 / T010 → T011.

---

## Implementation Strategy

### MVP First (User Story 1 only — there is only one)

1. Phase 1/2 are no-ops; jump straight to Phase 3.
2. Land T001-T007 in parallel.
3. T002 + T003 prove the test guard is real.
4. T008 proves the fix works in a real browser against a real PDS.
5. T009 + T010 prove no regression elsewhere.
6. T011 commits.

### Incremental Delivery

This fix is small enough to ship as one increment. There is no
post-MVP follow-up planned in this branch. Eligible follow-ups
(deferred per research.md "Alternatives considered"):

- Migrate to Netlify Functions v2 self-routing (`export const
  config = { path: '...' }`) and drop the `[[redirects]]` table
  entirely. Touches every handler signature; out of scope here.
- Add an end-to-end `vitest` smoke test that spawns `netlify dev`
  and curls each redirect. The static-analysis test in T001
  satisfies FR-009; the e2e smoke is a nice-to-have, not a
  requirement.

### Rollback

Per quickstart.md §"Rollback": if `netlify dev` proves unexpectedly
incompatible post-merge, revert T004 and T005 only. T001-T003 (the
new test) and T006/T007 (the docs) stay — the static-analysis test
catches the next routing-vs-files drift on the commit it lands on,
regardless of which dev command is canonical.

---

## Notes

- Tasks follow the spec's single P1 user story. There are no P2/P3
  stories — sign-in reachability is the only outcome in scope.
- `netlify-cli` is already a devDep at `^23.4.3`; do NOT add it
  again, do NOT bump it as part of this fix.
- Do NOT alter `netlify.toml`'s `[[redirects]]`, `[[headers]]`,
  `[functions]`, or `[build]` blocks. The redirect table is the
  source of truth after this fix — touching it is out of scope.
- Do NOT alter any handler body in `netlify/functions/*.ts`. FR-006
  requires every existing handler behavior to be preserved verbatim.
- Do NOT add CSS, change ESLint config, or write brittle tests
  (per `~/.claude/CLAUDE.md` and project `CLAUDE.md`).
- Commit after T011 only; do not split the four-file swap into
  separate commits — they are one atomic dev-workflow consolidation.
