---
description: "Task list for: Remove Subscription Messaging from Home Screen"
---

# Tasks: Remove Subscription Messaging from Home Screen

**Input**: Design documents from `/specs/002-remove-subscription-text/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: No new automated tests are added. Per `research.md` decision **D4**
and the user's global CLAUDE.md rule "DO NOT WRITE BRITTLE TESTS — do not
test for specific text content in HTML," verification is done via grep,
existing lint/test suites, manual smoke, and an accessibility-tree check
(see `quickstart.md`).

**Organization**: Tasks are grouped by user story. This feature has a
single user story (US1 / P1), so Phase 3 contains all implementation work.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story this task belongs to (US1 only here)
- File paths are absolute or repo-root-relative as appropriate

## Path Conventions

Single-project frontend SPA. All edits live under `src/routes/` at the
repository root. No `tests/` changes for this feature.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure.

No setup tasks. The project is already initialized, tooling is in place,
and this change introduces zero new dependencies, modules, or
configuration.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before any user
story can be implemented.

No foundational tasks. This feature is a pure UI deletion with no new
entities (per `data-model.md`), no new contracts beyond a "required
absences" UI contract (per `contracts/home-route-ui.md`), and no
prerequisites that block US1.

---

## Phase 3: User Story 1 - Free user sees a home screen without subscription messaging (Priority: P1) 🎯 MVP

**Goal**: Remove the "Drawings aren't saved without a subscription.
Subscribe to keep them and share them with the world" banner (and its
dedicated CSS rule) from the home route so that no user — signed-out,
signed-in non-paid, or signed-in paid — ever sees it.

**Independent Test**: Load `/` as a signed-out visitor and as a
signed-in non-paid user; confirm the banner text and the
`role="status"` / `aria-label="Save warning"` node are absent from the
DOM and the accessibility tree. Paid users see no regression. Drawing
flow (canvas, form, controls) renders unchanged for all states.

### Implementation for User Story 1

- [ ] T001 [US1] Remove the subscription warning aside (the
  `${state.isPaid.value ? null : html\`<aside class="free-account-warning"
  role="status" aria-label="Save warning">…</aside>\`}` block, currently
  lines ~181–192, including the surrounding blank line on the trailing
  side) from `src/routes/home.ts`. Leave all other `state.isPaid`
  branches in the file intact (per `research.md` D3).
- [ ] T002 [P] [US1] Remove the `& .free-account-warning { … }` rule
  (currently lines ~13–22) from `src/routes/home.css`. Do not touch any
  other rule in the file (per global CLAUDE.md: "NEVER change CSS that
  is not related to the task").

**Checkpoint**: After T001 and T002, the home route is missing the
banner and its dead CSS rule. The feature is complete; the remaining
phase is verification only.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Verification that the deletion is complete, nothing else
regressed, and the contract in `contracts/home-route-ui.md` holds.

- [ ] T003 Run static grep checks from `quickstart.md` §1 at the repo
  root: `grep -rn "Drawings aren't saved" src/`, `grep -rn "Subscribe to
  keep them" src/`, `grep -rn "free-account-warning" src/`, and
  `grep -rn "Save warning" src/`. Each must exit with status `1` (no
  matches).
- [ ] T004 Run `npm test && npm run lint` from the repo root per
  `quickstart.md` §2. Both must pass with the same outcomes as before
  the edit (no tests added or removed, no new lint findings).
- [ ] T005 Run the manual smoke from `quickstart.md` §3: `npm start`,
  open the home route, and verify the table — signed-out visitor,
  signed-in non-paid user, and signed-in paid user — all match the
  expected rendering. No banner above the canvas; intro paragraph,
  canvas, and form behave as before.
- [ ] T006 Run the accessibility-tree check from `quickstart.md` §4 in
  DevTools (Chrome Accessibility panel or Firefox Accessibility
  Inspector). Confirm no node with `role="status"` and
  `aria-label="Save warning"` exists on `/`, and no empty live region
  remains in its place (satisfies FR-004 and contract item 4).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No tasks; trivially satisfied.
- **Foundational (Phase 2)**: No tasks; trivially satisfied.
- **User Story 1 (Phase 3)**: Can start immediately. T001 and T002 are
  in different files and have no ordering dependency on each other.
- **Polish (Phase 4)**: Depends on Phase 3 being complete. Within
  Phase 4, T003 → T004 → T005 → T006 is the natural order (fast →
  slow, automated → manual), but T003 and T004 can run in either
  order.

### User Story Dependencies

- **User Story 1 (P1)**: The only story. No other stories to gate or
  integrate with.

### Within User Story 1

- T001 (edit `home.ts`) and T002 (edit `home.css`) touch different
  files and have no interdependency. Either order is correct.

### Parallel Opportunities

- T001 and T002 can be performed in parallel — different files, no
  shared state. Together they are the entire implementation.

---

## Parallel Example: User Story 1

```bash
# Both edits target different files and have no dependency on each other.
# A single developer should still do them in one commit since they form
# one logical change; the parallelism note is to clarify there is no
# ordering constraint.
Task: "Remove subscription warning aside from src/routes/home.ts"
Task: "Remove .free-account-warning CSS rule from src/routes/home.css"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

US1 is the entire feature. The MVP is the feature.

1. Phase 1 (Setup): nothing to do.
2. Phase 2 (Foundational): nothing to do.
3. Phase 3 (US1): perform T001 and T002, ideally as a single commit
   (`feat(home): remove subscription warning banner` or similar — the
   change is one logical unit).
4. Phase 4 (Polish/Verification): run T003–T006. **STOP and VALIDATE**
   after each: if a grep returns a hit, if a test/lint fails, or if any
   of the three user states still shows the banner, return to Phase 3.

### Incremental Delivery

Not applicable — the feature is one deletion. Ship Phase 3 + Phase 4
as a single PR.

### Rollback

Per `quickstart.md`: `git revert` the implementation commit. No data,
schema, or state migration is involved, so revert is safe.

---

## Notes

- [P] marks tasks that touch different files and have no
  inter-dependency.
- [US1] traces tasks to the single user story in `spec.md`.
- No new tests; verification is the four-step protocol in
  `quickstart.md` (grep, lint+unit, manual smoke, a11y-tree).
- Commit boundary: T001 + T002 in one commit is recommended; T003–T006
  are verification only and produce no commits unless a regression is
  discovered.
- Per global CLAUDE.md, do not touch unrelated CSS, ESLint settings,
  or write text-content-asserting tests while performing these tasks.
