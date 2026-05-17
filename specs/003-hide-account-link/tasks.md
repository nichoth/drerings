---

description: "Task list for implementing 003-hide-account-link"
---

# Tasks: Auth-gated Account link in header

**Input**: Design documents from `/specs/003-hide-account-link/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/nav-visibility.md, quickstart.md

**Tests**: Included. The design (research.md R-004) explicitly
specifies a new Vitest + `@testing-library/preact` test file at
`test/us029-nav-account-auth.test.ts`, modelled on the existing
`test/us028-nav-settings-auth.test.ts`. Tests are written BEFORE
implementation and MUST FAIL initially.

**Organization**: Grouped by user story. All three user stories
share a single implementation site (one filter predicate in
`src/index.ts`) and a single test file, so the test cases per
story are listed under that story but the test file is created
once in US1. Each story still has an independent acceptance check
that can be verified on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story this task serves (US1, US2, US3)
- File paths are absolute / repo-relative as appropriate.

## Path Conventions

Single-project SPA at repo root:

- Source: `src/`
- Tests: `test/`
- Specs: `specs/003-hide-account-link/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the working environment is ready. No new
project structure, dependencies, or tooling are introduced by this
feature (per plan.md and quickstart.md).

- [X] T001 Confirm working tree is on branch `003-hide-account-link` and `npm install` has been run; no new dependencies are added by this feature (`package.json` unchanged)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None required. The existing `Nav` component in
`src/index.ts` already receives `isAuthed` and `authLoading`, and
the `routes` array in `src/routes/index.ts` already contains the
`/account` entry. No schema, signal, or routing changes are
needed.

- [X] T002 Verify (read-only) that `src/index.ts` `Nav` already receives `isAuthed` and `authLoading` props and that `src/routes/index.ts` already exports an entry `{ href: '/account', text: 'Account' }`; no edits in this phase

**Checkpoint**: Foundation confirmed — user story work can begin.

---

## Phase 3: User Story 1 — Hide Account link from logged-out visitors (Priority: P1) MVP

**Goal**: For viewers without an active session (and during the
initial in-flight whoami check), the rendered `<nav>` must NOT
contain a link to `/account`. The link is omitted from the DOM, not
visually hidden (FR-002, C-001, C-004).

**Independent Test**: Open the site with no session cookie. The
header MUST NOT include an Account link. `document.querySelector('nav a[href="/account"]')` MUST return `null`. Settings continues to be omitted as well (no regression of feature 001).

### Tests for User Story 1 (write FIRST, ensure FAIL before T006)

- [X] T003 [US1] Create new test file `test/us029-nav-account-auth.test.ts` modelled on `test/us028-nav-settings-auth.test.ts`: include the `mountApp`, `makeState`, and `stubWhoami` helpers and a `describe('US-029 nav account link visibility', …)` block
- [X] T004 [US1] In `test/us029-nav-account-auth.test.ts`, add the loading-state case: with `{ authLoading: true, isAuthed: false }`, assert `screen.queryByRole('link', { name: /account/i })` is `null` AND that an unrelated link (e.g. Home or Drawings — queried by role/name, not raw text) is present, proving the nav rendered
- [X] T005 [US1] In `test/us029-nav-account-auth.test.ts`, add the anonymous-state case: with `{ authLoading: false, isAuthed: false }`, assert `screen.queryByRole('link', { name: /account/i })` is `null` AND assert DOM omission per C-004: `document.querySelector('a[href="/account"]')`, `document.querySelector('[aria-hidden="true"] a[href="/account"]')`, and `document.querySelector('[hidden] a[href="/account"]')` are all `null`
- [X] T006 [US1] Run `npm run test:e2e -- us029-nav-account-auth` and confirm the new T004 and T005 cases FAIL (the current `Nav` still renders `/account` for anonymous viewers); capture the failure output before implementing T007

### Implementation for User Story 1

- [X] T007 [US1] In `src/index.ts` inside the `Nav` component, extend the existing `routes.filter(...)` predicate so that the `/account` entry is dropped under the same condition as `/settings` (i.e. when `authLoading || !isAuthed`). Prefer the smallest diff: either inline `(r.href !== '/settings' && r.href !== '/account') || (!authLoading && isAuthed)`, or introduce a local `AUTH_ONLY_HREFS = ['/settings', '/account']` constant and check membership. Do NOT modify `src/routes/index.ts`, the `routes` array, or any CSS. Do NOT touch other Nav behavior (stamp balance link, logout/login swap)
- [X] T008 [US1] Re-run `npm run test:e2e -- us029-nav-account-auth` and confirm T004 and T005 now PASS, and re-run `npm run test:e2e -- us028-nav-settings-auth` to confirm the existing Settings test still PASSES (no regression of feature 001)

**Checkpoint**: Anonymous visitors no longer see Account in the header. MVP shippable in isolation if needed.

---

## Phase 4: User Story 2 — Show Account link to signed-in users (Priority: P1)

**Goal**: For viewers with `authLoading === false` AND
`isAuthed === true`, the rendered `<nav>` MUST contain exactly one
`<a href="/account">Account</a>` in its canonical position between
`/pricing` and `/colophon` (C-002). The `/settings` entry remains
present in this state (C-005 — Account and Settings always appear together).

**Independent Test**: Sign in. Inspect the header. Account appears in the same position it did before this change and navigates to the existing account page.

### Tests for User Story 2 (add to the file created in T003)

- [X] T009 [US2] In `test/us029-nav-account-auth.test.ts`, add the authenticated case: with `{ authLoading: false, isAuthed: true }`, assert `await screen.findByRole('link', { name: /account/i })` is truthy AND that the returned link's `href` attribute is exactly `/account`
- [X] T010 [US2] In `test/us029-nav-account-auth.test.ts`, add the canonical-position case (mirrors the equivalent us028 case): with `{ authLoading: false, isAuthed: true }`, render `Nav`, then within `nav[aria-label="Main navigation"]` get all links via `within(nav).getAllByRole('link')` and assert that the link with `href="/account"` appears in its canonical position — immediately after `/pricing` and immediately before `/colophon`, per contract C-002 (deviates from the verbatim task text "before /settings", which contradicts the canonical routes array). Do not assert against the text content of unrelated links (per repo CLAUDE.md tests rule)
- [X] T011 [US2] In `test/us029-nav-account-auth.test.ts`, add a C-005 symmetry case: with `{ authLoading: false, isAuthed: true }`, assert both `screen.queryByRole('link', { name: /account/i })` and `screen.queryByRole('link', { name: /settings/i })` are non-null in the same render; with `{ authLoading: false, isAuthed: false }`, assert both are `null` in the same render

### Implementation for User Story 2

No additional implementation needed. The single filter change made in **T007** already satisfies US2 because the predicate now treats `/account` identically to `/settings` under the unified `(!authLoading && isAuthed)` condition. The tests T009–T011 are the verification.

- [X] T012 [US2] Run `npm run test:e2e -- us029-nav-account-auth` and confirm T009, T010, and T011 PASS without further code changes; if any fail, revisit T007 (do not add a parallel filter path)

**Checkpoint**: Signed-in users continue to see the Account link in its existing position; Account and Settings render together (C-005).

---

## Phase 5: User Story 3 — Link visibility updates when auth state changes (Priority: P2)

**Goal**: Within a single document lifetime, the Account link must
appear on sign-in and disappear on sign-out without a manual page
reload, within one Preact render cycle (C-003, FR-003).

**Independent Test**: Start signed out → confirm Account hidden. Sign in within the same tab → confirm Account appears with no reload. Sign out → confirm Account disappears again.

### Tests for User Story 3 (add to the file created in T003)

- [X] T013 [US3] In `test/us029-nav-account-auth.test.ts`, add the sign-in transition case: start with `{ authLoading: false, isAuthed: false }`, mount, assert Account is null, then `act(() => { state.auth.value = { authenticated: true, registered: true } })`, then assert `await screen.findByRole('link', { name: /account/i })` is truthy
- [X] T014 [US3] In `test/us029-nav-account-auth.test.ts`, add the sign-out transition case: start with `{ authLoading: false, isAuthed: true }`, mount, assert Account is present, then `act(() => { state.auth.value = { authenticated: false, registered: false } })`, then `await waitFor(() => expect(screen.queryByRole('link', { name: /account/i })).toBeNull())`
- [X] T015 [US3] In `test/us029-nav-account-auth.test.ts`, add the anti-flash case (C-003 / FR-004): start with `{ authLoading: true, isAuthed: false }`, mount, assert Account is null; then `act(() => { state.authLoading.value = false })` (keeping `isAuthed === false`) and assert Account remains `null` across the transition — the link MUST NOT appear at any point for an anonymous viewer when the in-flight whoami resolves to unauthenticated

### Implementation for User Story 3

No additional implementation needed. Preact signals automatically re-render `Nav` when `state.auth` or `state.authLoading` changes, and the filter from T007 re-evaluates on every render, so transitions are implicit. T013–T015 are pure verification.

- [X] T016 [US3] Run `npm run test:e2e -- us029-nav-account-auth` and confirm T013, T014, and T015 PASS without further code changes

**Checkpoint**: All three user stories are independently functional and tested.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across the whole suite and manual
smoke test per `quickstart.md`.

- [X] T017 Run `npm test` (tapzero suite) and confirm 0 failures — this feature does not touch tapzero coverage but the full suite must remain green
- [X] T018 Run `npm run test:e2e` (full vitest suite) and confirm 0 failures — explicitly verifies that `us028-nav-settings-auth.test.ts` and all other UI tests still pass alongside the new `us029-nav-account-auth.test.ts` — NOTE: 2 pre-existing failures in `test/us013-pricing-page.test.ts` were verified to exist on the baseline (without this feature's changes) and are unrelated to this feature (they test pricing-page subscription form behavior)
- [X] T019 Run `npm run lint` and confirm 0 errors / 0 warnings; per repo CLAUDE.md, do NOT modify the eslint config to silence issues — fix any reported lint diagnostics in `src/index.ts` or `test/us029-nav-account-auth.test.ts` instead
- [ ] T020 Execute the manual smoke test in `specs/003-hide-account-link/quickstart.md` sections "Manual smoke test" (US-1 anonymous, US-2 signed in, US-3 in-session state change) in a real browser via `npm start`; confirm DevTools shows `document.querySelector('nav a[href="/account"]')` returns `null` when signed out and an `<a>` element when signed in — DEFERRED to user: manual browser verification

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup; verification-only, no code edits.
- **User Story 1 (Phase 3)**: Depends on Phase 2. Contains the only implementation task (T007); US2 and US3 reuse it.
- **User Story 2 (Phase 4)**: Depends on T007 (the filter change). Tests in US2 will fail without T007, since the implementation is shared.
- **User Story 3 (Phase 5)**: Depends on T007. Tests are pure verification of the reactive behavior delivered by T007 + the existing signals plumbing.
- **Polish (Phase 6)**: Depends on US1, US2, US3 tests all passing.

### User Story Dependencies

- **US1 (P1)** delivers the implementation. It is the MVP and is shippable alone (signed-out users no longer see Account; signed-in users already see it because they did before).
- **US2 (P1)** does NOT add new implementation; it adds verification that the existing signed-in behavior is preserved after the US1 filter change. It depends on T007 for its tests to pass.
- **US3 (P2)** does NOT add new implementation; it verifies reactivity. It depends on T007 for its tests to pass.

### Within Each User Story

- **US1**: T003 (file creation) → T004, T005 (cases in that file) → T006 (red) → T007 (green) → T008 (verify).
- **US2**: T009, T010, T011 can be authored in any order, but all touch the same test file (cannot run truly in parallel); then T012 verifies.
- **US3**: T013, T014, T015 same pattern; then T016 verifies.

### Parallel Opportunities

- All tasks within a single user story touch the same one or two files (`src/index.ts` and `test/us029-nav-account-auth.test.ts`), so very few `[P]` markers apply here. The feature is intentionally small.
- Across user stories, US2 and US3 tests can be authored in parallel by different developers AFTER T007 lands, because they only add new test cases to a shared file (merge-time only conflicts).
- The full `npm run test:e2e` (T018) and `npm run lint` (T019) can run in parallel as independent verification commands.

---

## Parallel Example: After T007 lands

```bash
# Two developers can simultaneously author the remaining test cases.
# They both edit the same file (test/us029-nav-account-auth.test.ts)
# so coordinate via small commits, but the work itself is independent.
Task: "Add T009, T010, T011 (US2 cases) to test/us029-nav-account-auth.test.ts"
Task: "Add T013, T014, T015 (US3 cases) to test/us029-nav-account-auth.test.ts"

# Verification commands run in parallel:
Task: "npm run test:e2e -- us029-nav-account-auth"
Task: "npm run lint"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001–T002 (confirm environment / read-only checks).
2. T003–T006: write the failing tests for the anonymous and loading states.
3. T007: extend the filter predicate in `src/index.ts`.
4. T008: tests for US1 pass; us028 still passes.
5. **STOP and VALIDATE**: open the app in a private window — Account is gone for anonymous; signed-in users (verified separately) still see it. Ship if needed.

### Incremental Delivery

1. Land US1 (filter change + anonymous/loading tests).
2. Add US2 test cases (no code change) → verify signed-in regression is covered.
3. Add US3 test cases (no code change) → verify reactive transitions are covered.
4. Run polish phase (full suite + lint + manual smoke).

### Single-Developer Strategy

The whole feature is one filter-line change plus one test file. A single developer can implement it in a single sitting: do T003–T006 (red), T007 (green), then T009–T015 to lock in US2 and US3 behavior, then T017–T020 to ship.

---

## Notes

- `[P]` markers are sparse in this feature because the implementation is intentionally one line in one file and the tests share one file.
- Tests use role/name queries (`getByRole('link', { name: /account/i })`), per repo CLAUDE.md ("do not test for specific text content in HTML" — accessible-name regex is allowed and explicitly suggested by `contracts/nav-visibility.md`).
- No CSS changes anywhere — repo CLAUDE.md forbids touching unrelated CSS, and this feature has no CSS need (FR-002 mandates DOM omission, not visual hiding).
- No edits to `src/routes/index.ts`; the `routes` array remains the source of truth for "all possible nav destinations" and is still consumed by the router for matching `/account` → `AccountRoute` (research.md R-003).
- No new dependencies, no `package.json` change, no env vars (quickstart.md).
- Commit cadence: one commit for T003–T006 (red tests), one commit for T007 (green), one commit for T009–T015 (additional cases), and a final commit for polish if anything was tweaked. Avoid mixing implementation and unrelated cleanup in the same commit.
