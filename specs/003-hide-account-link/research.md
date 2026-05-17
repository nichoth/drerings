# Phase 0 Research: Auth-gated Account link in header

**Feature**: 003-hide-account-link
**Date**: 2026-05-16

The feature spec is small and the Technical Context contains no
`NEEDS CLARIFICATION` markers. The questions worth resolving up
front are how this header already gates other auth-only links
(feature 001 just did it for `/settings`), and whether the existing
filter mechanism extends naturally to a second auth-only entry.
Findings below.

## R-001 — Auth signal source of truth

- **Decision**: Reuse the existing `state.auth.value?.authenticated`
  (exposed to `Nav` as the `isAuthed` prop) and
  `state.authLoading.value` (passed as the `authLoading` prop) that
  the `Nav` component already receives in `src/index.ts`. No new
  signals, no new wiring.
- **Rationale**: Single source of truth; the same two props already
  drive the `/settings` filter added in feature 001. Adding a second
  auth-only link should not introduce a parallel auth concept.
- **Alternatives considered**:
  - *Add an `isAuthed` check inside `routes/account.ts`*: rejected —
    the route module has no access to signals and shouldn't; the
    view layer is the right place for view-time gating.
  - *Introduce a generic `authOnly: true` flag on the route entries*:
    viable and slightly more extensible, but the project still has
    only two auth-only entries (`/settings`, `/account`) and the
    flag would replace one one-line filter with a new schema. Defer
    until a third auth-only header link actually appears (YAGNI).

## R-002 — Anti-flash behavior during initial auth check

- **Decision**: Treat `authLoading === true` as the signed-out
  branch for the Account link, identical to how the Settings link
  is treated. While the initial whoami request is in-flight, the
  Account link is omitted.
- **Rationale**: FR-004 mandates default-to-hidden while auth is
  unresolved. The header already does exactly this for the Logout
  / Login swap and for the Settings link, so this keeps behavior
  uniform and prevents the "link appears, then disappears" flicker
  that SC-001 forbids.
- **Alternatives considered**:
  - *Render the Account link optimistically and remove on resolve*:
    rejected — produces the exact flash FR-004 forbids.
  - *Track a separate `accountResolved` signal*: rejected —
    `authLoading` already represents this transition.

## R-003 — Where to filter the Account entry

- **Decision**: Extend the existing `routes.filter(...)` predicate
  inside the `Nav` component in `src/index.ts` to also drop the
  `/account` entry when `authLoading || !isAuthed`. Keep the
  static `routes` export in `src/routes/index.ts` intact — it
  remains the source of truth for "all possible nav destinations"
  and is also consumed by the router for matching.
- **Rationale**: Smallest blast radius. `routes` is consumed both
  by the router (for matching `/account` -> `AccountRoute`) and by
  `Nav` (for rendering). Removing entries from the array would
  break routing; gating at the view layer is a one-line predicate
  change. This mirrors how feature 001 handled `/settings`.
- **Alternatives considered**:
  - *Add an `authOnly: true` flag and a generic filter*: see R-001;
    deferred until a third auth-only link exists.
  - *Two separate `.filter()` calls (one per auth-only route)*:
    rejected — produces a larger diff and obscures the shared
    "is the viewer effectively signed in" condition; a single
    predicate over an array of auth-only hrefs is clearer.

## R-004 — Test surface and tooling

- **Decision**: Add a new Vitest + `@testing-library/preact` test
  file `test/us029-nav-account-auth.test.ts` modelled directly on
  the existing `test/us028-nav-settings-auth.test.ts`. The test
  drives the `Nav` component under the three auth states
  (loading, unauthenticated, authenticated) and asserts the
  Account link's presence/absence via role/name queries
  (`screen.queryByRole('link', { name: /account/i })`). It also
  covers the two in-session transitions (US-3) and the DOM-omission
  contract (FR-002).
- **Rationale**: Vitest is the established harness for UI
  visibility checks. The tapzero suite (`test/index.ts`) is
  reserved for pure-function and state assertions and does not
  run a DOM, so it cannot directly verify the rendered header.
  Reusing the exact pattern from `us028` keeps the two auth-gating
  tests symmetric and easy to maintain.
- **Alternatives considered**:
  - *Extend `us028-nav-settings-auth.test.ts` with Account
    assertions*: rejected — couples two independent features in
    one file; a regression in either would name the other.
  - *Playwright end-to-end test*: overkill for a render-time DOM
    check; reserved for behaviors that need a real browser.

## R-005 — Test file naming

- **Decision**: Use `us029-nav-account-auth.test.ts`. The repo's
  test files are numbered sequentially by user-story (`us001`,
  `us002`, ...) and the most recent in this style is
  `us028-nav-settings-auth.test.ts` (added by feature 001), so
  `us029` is the next free slot.
- **Rationale**: Keeps naming continuous with the existing
  convention and makes the relationship to `us028` obvious at a
  glance.

## Constraints honored

- FR-002: filter must produce DOM omission, not CSS hiding —
  satisfied by `routes.filter(...)` before the `map`.
- FR-005: no change to order, label, or visibility of any other
  header item — satisfied because the predicate only removes
  `/account` from the rendered list; every other entry passes
  through unchanged. The `/settings` filter from feature 001 is
  preserved.
- CSS rule from `~/.claude/CLAUDE.md` ("NEVER change CSS that is
  not related to the task"): no CSS changes planned.
- Tests rule from `~/.claude/CLAUDE.md` ("do not test for specific
  text content in HTML"): all assertions use accessible role/name
  queries, not raw text matching of unrelated nav items.

## Open questions

None remaining. All Technical Context fields are resolved.
