---

description: "Task list for Auth-gated Settings link in header"
---

# Tasks: Auth-gated Settings link in header

**Input**: Design documents from `/specs/001-settings-link-auth/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/nav-visibility.md, quickstart.md

**Tests**: Test tasks ARE included. The feature spec lists automated
checks as Measurable Outcomes (SC-001, SC-002, SC-003) and the
contracts/quickstart explicitly call for a new Vitest UI test file
(`test/us028-nav-settings-auth.test.ts`). Tests precede
implementation (TDD).

**Organization**: Tasks are grouped by user story so each can be
implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different files, no dependencies on incomplete tasks
- **[Story]**: `US1`, `US2`, or `US3` (matches spec.md user stories)
- File paths are absolute or rooted at the repo (`/Users/nick/code/drerings`)

## Path Conventions

- Single-project SPA. Edits land in `src/` and a new test in `test/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the branch and tooling are ready for the change.
There is no scaffolding to add — this feature is a pure UI gating
change.

- [ ] T001 Confirm working tree is on branch `001-settings-link-auth`
  with a clean status (`git status` from the repo root).
- [ ] T002 [P] Run `npm install` from the repo root to ensure deps are
  resolved (no `package.json` change is planned in this feature).
- [ ] T003 [P] Verify the baseline checks pass before any edit: run
  `npm test`, `npm run test:e2e`, and `npm run lint` from the repo
  root; record any pre-existing failures so they are not attributed
  to this feature.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the typed signal plumbing that every user
story below depends on. After this phase, the `Nav` component can be
filtered by auth state, and the new Vitest UI test file has the
mocks/helpers it needs to drive the three contract states.

**CRITICAL**: No user story work can begin until this phase is
complete — all three stories use the same component signature and
the same test harness.

- [ ] T004 Update the `Nav` component signature in
  `/Users/nick/code/drerings/src/index.ts` to accept the new auth
  inputs alongside the existing `route` prop. Add `isAuthed:boolean`
  and `authLoading:boolean` to its props (per
  `contracts/nav-visibility.md` "Inputs" table and `data-model.md`
  "Existing entities"). Do NOT change the rendered output yet — the
  filter behavior comes in the per-story tasks. Keep the existing
  `routes` import; do NOT mutate the array.
- [ ] T005 Wire the new `Nav` props from the parent `Drerings`
  component in `/Users/nick/code/drerings/src/index.ts`. Pass
  `isAuthed=${isAuthed.value}` (the existing local `useComputed`)
  and `authLoading=${state.authLoading.value}` to `<${Nav} />`. Do
  not introduce a new signal; reuse `state.authLoading` and the
  existing local `isAuthed`. Confirm `npm run lint` still passes.
- [ ] T006 [P] Create the empty Vitest test file
  `/Users/nick/code/drerings/test/us028-nav-settings-auth.test.ts`
  modeled on `test/us017-account-ui.test.ts`: import `h` from
  `preact`, `render`/`screen` from `@testing-library/preact`,
  `describe`/`it`/`afterEach`/`vi` from `vitest`, and `State` from
  `../src/state`. Add `afterEach(() => vi.unstubAllGlobals())`. Use a
  `describe('US-028 nav settings link visibility', ...)` block. Do
  not yet add the three contract test bodies — those land in their
  story phases.
- [ ] T007 [P] In the same test file, add two private helpers (kept
  inside the file, not exported): (a) `mountApp(state)` that imports
  `Drerings` from `../src/index` and renders `h(Drerings, {})` after
  attaching the `state` to `window.state` only for the test
  lifetime; or, if a direct `Nav` import is simpler, render the
  `Nav` function imported from `../src/index` with the
  `route`/`isAuthed`/`authLoading` props described in
  `contracts/nav-visibility.md`. (b) `stubWhoami({ authenticated })`
  that calls `vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true,
  json: async () => ({ authenticated }) })))`. These helpers are
  shared by US1/US2/US3 test bodies.

**Checkpoint**: The `Nav` component takes the new auth inputs (even
if it does not yet act on them), `Drerings` passes them in, and the
test file is set up to drive all three contract scenarios. All user
story phases below can now proceed; they can be picked up by
different developers in parallel because they each touch a different
contract case (`it(...)` block) and exercise different states of the
same already-plumbed inputs.

---

## Phase 3: User Story 1 - Hide Settings link from logged-out visitors (Priority: P1) -- MVP

**Goal**: When the viewer is not signed in (or auth has not resolved
yet), the rendered `<nav>` MUST NOT contain a `/settings` link, and
the link MUST be absent from the DOM (FR-001, FR-002, FR-004;
contract C-001, C-004).

**Independent Test**: From `contracts/nav-visibility.md` and
`spec.md` US-1: load the app with no session
(`fetch('/api/whoami')` stubbed to return `{ authenticated: false }`,
and again with `authLoading=true`) and assert
`screen.queryByRole('link', { name: /settings/i })` is `null`. Other
nav entries (`/`, `/drawings`, `/pricing`, `/account`, `/colophon`)
must still render.

### Tests for User Story 1 (write FIRST, must FAIL before implementation)

- [ ] T008 [P] [US1] In
  `/Users/nick/code/drerings/test/us028-nav-settings-auth.test.ts`,
  add an `it('omits Settings while auth is loading', async () =>
  {...})` block. Render the Nav with `authLoading=true` and
  `isAuthed=false` and assert `screen.queryByRole('link', { name:
  /settings/i })` is `null`. Also assert at least two unrelated nav
  links still render via role/name queries (e.g. Home, Drawings) so
  the test catches accidental removals — per repo CLAUDE.md, query
  by role/name; do NOT assert specific text of unrelated header
  links beyond presence-by-role. Run the test and confirm it FAILS
  before T011 lands.
- [ ] T009 [P] [US1] In the same test file, add an `it('omits
  Settings for an anonymous viewer', async () => {...})` block.
  Stub `fetch('/api/whoami')` via the T007 helper to return
  `{ authenticated: false }`, drive the app to resolved state
  (`authLoading=false`, `isAuthed=false`), and assert
  `screen.queryByRole('link', { name: /settings/i })` is `null`.
  Run the test and confirm it FAILS before T011 lands.
- [ ] T010 [P] [US1] In the same test file, add an `it('does not
  visually hide a Settings link — it is absent from the DOM',
  async () => {...})` block to enforce contract C-004 / FR-002.
  After the unauthenticated render, assert
  `document.querySelector('a[href="/settings"]')` is `null` AND no
  element with `aria-hidden="true"` or `hidden` attribute points at
  `/settings`. Run the test and confirm it FAILS before T011 lands.

### Implementation for User Story 1

- [ ] T011 [US1] Update the `Nav` body in
  `/Users/nick/code/drerings/src/index.ts` to filter the routes
  array before rendering: replace `routes.map(...)` with
  `routes.filter(r => r.href !== '/settings' || (!authLoading &&
  isAuthed)).map(...)`. Per `data-model.md` "Visibility decision"
  and `research.md` R-002, evaluate `authLoading` first — while
  loading, the Settings entry is filtered out even if `isAuthed` is
  truthy (anti-flash). Do NOT add CSS, `display:none`,
  `aria-hidden`, or a `hidden` attribute — the entry must be
  omitted from the rendered list (FR-002).
- [ ] T012 [US1] Re-run the three US1 tests (T008, T009, T010) and
  confirm they now PASS. Also re-run `npm run lint` and `npm test`
  from the repo root and confirm zero new failures.

**Checkpoint**: User Story 1 is complete. The header omits Settings
for anonymous and loading viewers; the link is absent from the DOM
rather than visually hidden. SC-001 ("100% of header renders for
unauthenticated viewers exclude the Settings link") is satisfied.
This is the MVP slice — at this point the change could in principle
ship without US2 if US2 were already covered, but in practice US2 is
also P1 and must be verified before merge.

---

## Phase 4: User Story 2 - Show Settings link to signed-in users (Priority: P1)

**Goal**: When auth has resolved AND `isAuthed === true`, the
rendered `<nav>` MUST contain exactly one `<a>` element with
`href="/settings"` and visible text "Settings", in the same position
as the canonical `routes` array (last entry) (FR-001, FR-005;
contract C-002).

**Independent Test**: From `contracts/nav-visibility.md` and
`spec.md` US-2: load the app with `fetch('/api/whoami')` stubbed to
return `{ authenticated: true }`, wait for the auth resolve, and
assert `screen.findByRole('link', { name: /settings/i })` succeeds
and resolves to an element with `href="/settings"`. Other nav
entries remain unchanged.

### Tests for User Story 2 (write FIRST, must FAIL before implementation)

- [ ] T013 [P] [US2] In
  `/Users/nick/code/drerings/test/us028-nav-settings-auth.test.ts`,
  add an `it('shows Settings for an authenticated viewer', async ()
  => {...})` block. Stub `fetch('/api/whoami')` via the T007 helper
  to return `{ authenticated: true }`, drive the app to resolved
  state (`authLoading=false`, `isAuthed=true`), and assert that
  `await screen.findByRole('link', { name: /settings/i })` is
  truthy and has `getAttribute('href') === '/settings'`. Run the
  test before T011 has landed — it should FAIL (no link rendered);
  after T011, this story's test should already PASS as a free
  byproduct because the filter only omits when the gate is true.
  Note that intent: this test exists to lock in C-002 against
  regressions in subsequent edits.
- [ ] T014 [P] [US2] In the same test file, add an `it('renders the
  Settings link in its canonical position', async () => {...})`
  block. With the authenticated stub, render the Nav, query
  `screen.getAllByRole('link')` inside the `nav[aria-label="Main
  navigation"]` region (use `within(screen.getByRole('navigation',
  { name: /main navigation/i }))`), and assert that the last link
  is the Settings link. This enforces C-002 ordering without
  asserting specific text of unrelated links beyond presence.

### Implementation for User Story 2

- [ ] T015 [US2] No additional production code change is expected:
  if T011 is implemented as a `routes.filter(...)` that only omits
  `/settings` when the auth gate is false, the authenticated path
  already passes the entry through. Re-read
  `/Users/nick/code/drerings/src/index.ts` and confirm: (a) the
  `routes` import still includes the Settings entry, (b) when
  `authLoading=false && isAuthed=true`, the filter predicate keeps
  the entry, (c) the rendered `<a>` uses `r.href` and `r.text` from
  the canonical routes array so the label remains "Settings". If
  any of those is false, fix it inside `Nav` only — do NOT touch
  `src/routes/index.ts`.
- [ ] T016 [US2] Run T013 and T014 and confirm both PASS. Run
  `npm run lint` and `npm test` from the repo root and confirm no
  new failures.

**Checkpoint**: User Story 2 is complete. The Settings link is
present for authenticated viewers in its canonical position with
its canonical label. SC-002 ("100% of header renders for
authenticated users include the Settings link in its existing
position") is satisfied. SC-004 ("dead-end clicks drop to zero") is
structurally guaranteed by US1 + US2 together.

---

## Phase 5: User Story 3 - Link visibility updates when auth state changes (Priority: P2)

**Goal**: A transition of `isAuthed` (false → true or true → false)
within a single document MUST update the rendered nav within one
Preact render cycle, with no manual reload (FR-003; contract C-003).

**Independent Test**: From `contracts/nav-visibility.md` and
`spec.md` US-3: start signed-out (Settings absent), flip the
underlying `state.auth` signal to authenticated, and assert that
the Settings link appears in the next microtask without an explicit
re-render call. Then flip back to signed-out and assert the link
disappears.

### Tests for User Story 3 (write FIRST, must FAIL before implementation)

- [ ] T017 [P] [US3] In
  `/Users/nick/code/drerings/test/us028-nav-settings-auth.test.ts`,
  add an `it('reveals Settings on sign-in without reload', async ()
  => {...})` block. Create a `State()` instance, render via the
  T007 helper with `authLoading=false` and `isAuthed=false` (or by
  driving the underlying signal), assert
  `screen.queryByRole('link', { name: /settings/i })` is `null`,
  then `act(() => { state.auth.value = { authenticated: true,
  registered: true } })` (or call the equivalent setter), and
  `await screen.findByRole('link', { name: /settings/i })` resolves
  truthy without any manual re-render or reload.
- [ ] T018 [P] [US3] In the same test file, add an `it('hides
  Settings on sign-out without reload', async () => {...})` block:
  start authenticated (link present), then clear the auth signal
  (`state.auth.value = { authenticated: false, registered: true }`
  or call `State.Logout(state)` with `fetch` stubbed), and assert
  the link disappears via
  `await waitFor(() => expect(screen.queryByRole('link', { name:
  /settings/i })).toBeNull())`.

### Implementation for User Story 3

- [ ] T019 [US3] No additional production code change is expected
  if T005 wired the `Nav` to read from `state.authLoading.value`
  and from the `isAuthed` computed: Preact signals already trigger
  a re-render on signal change, and the filter re-runs each render.
  Re-read `/Users/nick/code/drerings/src/index.ts` and confirm that
  the `Nav` invocation site (a) reads `state.authLoading.value`
  inside the render function (not captured outside it), and (b)
  reads from the local `isAuthed` `useComputed` (which depends on
  `state.auth.value`). If `Nav` instead receives a snapshot
  captured outside the render path, refactor so the signal reads
  happen each render — but do NOT introduce a new effect, listener,
  or manual subscription; the existing signal reactivity is the
  contract per `research.md` R-001.
- [ ] T020 [US3] Run T017 and T018 and confirm both PASS. Run the
  full suite once more (`npm test`, `npm run test:e2e`,
  `npm run lint`) from the repo root and confirm zero new failures.

**Checkpoint**: User Story 3 is complete. SC-003 ("after a sign-in
or sign-out action within a single session, the header reflects the
new state within one render cycle") is satisfied.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, lint/format hygiene, and manual
smoke-test against `quickstart.md`. No new features.

- [ ] T021 [P] Manually run the smoke test from
  `/Users/nick/code/drerings/specs/001-settings-link-auth/quickstart.md`
  (US-1 fresh private window, US-2 sign-in, US-3 logout/login
  toggle). Confirm in DevTools that
  `document.querySelector('nav a[href="/settings"]')` returns
  `null` for the unauthenticated case (FR-002 / C-004).
- [ ] T022 [P] Confirm zero CSS changes in this branch: run
  `git diff --stat main -- src/style.css src/**/*.css` from the
  repo root and confirm the output is empty. Per the user's global
  CLAUDE.md, CSS changes unrelated to the task are forbidden.
- [ ] T023 [P] Confirm zero changes to `src/routes/index.ts`:
  `git diff --stat main -- src/routes/index.ts` from the repo root
  must be empty (per `research.md` R-003: filtering happens at the
  view layer; the canonical `routes` array stays intact so the
  router still matches `/settings`).
- [ ] T024 Run the full automated suite one last time:
  `npm test && npm run test:e2e -- us028-nav-settings-auth &&
  npm run lint`. All must pass.
- [ ] T025 Re-read
  `/Users/nick/code/drerings/specs/001-settings-link-auth/spec.md`
  Functional Requirements (FR-001..FR-005) and Success Criteria
  (SC-001..SC-004) and check each off against the implemented
  behavior. Capture any gap as a follow-up issue rather than a
  silent fix.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user
  stories — every story consumes the `Nav` signature changed in
  T004/T005 and the test helpers added in T006/T007.
- **User Story 1 (Phase 3)**: Depends on Foundational. MVP slice.
- **User Story 2 (Phase 4)**: Depends on Foundational. Locks in
  authenticated behavior. Can be developed in parallel with US1 by
  a different developer because the production change is the same
  one-line filter — but the tests live in independent `it(...)`
  blocks.
- **User Story 3 (Phase 5)**: Depends on Foundational. Can be
  developed in parallel with US1 and US2; the only production
  dependency is that signals are read inside the render path,
  which T004/T005 already establish.
- **Polish (Phase 6)**: Depends on US1, US2, and US3.

### User Story Dependencies

- US1 (P1) and US2 (P1): independent slices of the same filter
  expression. They share a production code change (T011) but
  exercise opposite branches and live in separate `it(...)` blocks.
- US3 (P2): independent of US1 and US2 at the test level; relies
  on the same signal-reading pattern established in Foundational.

### Within Each User Story

- Write tests FIRST and confirm they FAIL.
- Land the production change.
- Re-run the tests and confirm they PASS.
- Run lint and the full suite before moving on.

### Parallel Opportunities

- T002 and T003 (Setup) can run together.
- T006 and T007 (Foundational test scaffold) can run together; they
  touch the same file, so they must be merged into one edit if
  worked by a single agent, but they describe independent helpers
  that two developers could write side-by-side.
- US1 test tasks T008, T009, T010 can be authored in parallel (all
  three add separate `it(...)` blocks to the same file; merge
  carefully).
- US2 test tasks T013, T014 can be authored in parallel.
- US3 test tasks T017, T018 can be authored in parallel.
- Polish tasks T021, T022, T023 can run in parallel.

---

## Parallel Example: User Story 1

```bash
# Author the three US1 contract assertions side-by-side
# (they each add a separate `it(...)` to the same test file —
# coordinate with a single Edit if a single agent is doing this):

Task: "T008 [US1] Add `it('omits Settings while auth is loading')`
   to test/us028-nav-settings-auth.test.ts"
Task: "T009 [US1] Add `it('omits Settings for an anonymous viewer')`
   to test/us028-nav-settings-auth.test.ts"
Task: "T010 [US1] Add `it('does not visually hide a Settings link')`
   to test/us028-nav-settings-auth.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational — `Nav` accepts the auth inputs,
   `Drerings` passes them in, test scaffold is in place.
3. Complete Phase 3: User Story 1 — anonymous and loading viewers
   no longer see Settings. The link is omitted from the DOM.
4. STOP and VALIDATE manually against `quickstart.md` US-1.

### Incremental Delivery

1. Setup + Foundational → ready.
2. US1 → MVP slice; ship-ready if the only goal is to stop the
   dead-end clicks for anonymous visitors. (In this feature US2 is
   also P1 and is structurally guaranteed by the same filter, so
   shipping US1 alone is not recommended.)
3. US2 → locks in the authenticated case with explicit tests.
4. US3 → locks in the reactive update case with explicit tests.
5. Polish → manual smoke, no-CSS-changes audit, full suite.

### Parallel Team Strategy

This feature is small enough that one developer should own the
whole change. The parallel structure above is provided for
completeness and for use by a multi-agent runner.

---

## Notes

- [P] tasks = different files OR independent edits in the same file
  that can be planned in parallel and merged in one Edit.
- [Story] label maps each task to its user story for traceability.
- Per repo CLAUDE.md: query tests by role/name; do NOT assert
  specific text content of unrelated header links; do NOT change
  CSS or eslint settings; do NOT introduce a new signal where the
  existing `state.auth` / `state.authLoading` / `isAuthed` suffice.
- Per global CLAUDE.md: no lines longer than 80 columns; TypeScript
  type annotations use no space between colon and type
  (`isAuthed:boolean`).
- Verify tests FAIL before implementing the filter (RED → GREEN).
- Commit per user story (or per logical task group) so each story
  can be reverted independently.
