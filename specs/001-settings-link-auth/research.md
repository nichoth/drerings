# Phase 0 Research: Auth-gated Settings link in header

**Feature**: 001-settings-link-auth  
**Date**: 2026-05-15

The feature spec is small and the technical context contains no
`NEEDS CLARIFICATION` markers. The questions worth resolving up
front are how the existing app already encodes "is the viewer
authed?", how it already gates other header affordances, and what
test harness fits the new behavioral assertions. Findings below.

## R-001 — Auth signal source of truth

- **Decision**: Reuse the existing `state.auth` /
  `state.isAuthed` / `state.authLoading` signals defined in
  `src/state.ts`. The header in `src/index.ts` already derives a
  local `isAuthed` via `useComputed` from `state.auth.value`. The
  Nav filter will read the same signals — no new state.
- **Rationale**: Single source of truth; matches how the Logout
  / Login swap in the header is already implemented; consistent
  with the spec's assumption that the app "already has a reliable
  signal for is the current viewer signed in".
- **Alternatives considered**:
  - *Add a new `showSettings` signal*: rejected — duplicates
    `isAuthed` and creates two ways to be "logged in".
  - *Read directly from `state.currentUser`*: rejected — equivalent
    information but less direct; `isAuthed` is the established
    public contract.

## R-002 — Anti-flash behavior during initial auth check

- **Decision**: Treat `state.authLoading.value === true` as the
  signed-out branch for the purposes of the Settings link. The
  header already does this for the Logout/Login swap (it renders a
  disabled placeholder Logout button while loading), so the Nav
  must follow the same convention so the link never flashes for
  anonymous visitors.
- **Rationale**: FR-004 mandates default-to-hidden while auth is
  unresolved; the existing header pattern is exactly this; aligns
  with SC-001 (100% of unauth renders exclude the link).
- **Alternatives considered**:
  - *Render the link optimistically and remove on resolve*:
    rejected — produces the exact flash FR-004 forbids.
  - *Render a placeholder slot in the nav*: rejected — adds
    layout complexity for an item that is already not shown to
    most visitors most of the time.

## R-003 — Where to filter the Settings entry

- **Decision**: Filter inside the `Nav` component in
  `src/index.ts` at render time, using the auth signals already
  available to the component's parent. Keep the static `routes`
  export in `src/routes/index.ts` complete (it remains the source
  of truth for "all possible nav destinations") and let the view
  decide which to render.
- **Rationale**: Smallest blast radius — `routes` is also imported
  by the router for matching; changing the array itself would
  remove the Settings route from routing entirely. Filtering at
  the view layer is a one-line change and keeps routing and
  rendering concerns separate.
- **Alternatives considered**:
  - *Add an `authOnly: true` flag on the route entry and filter
    generically*: viable and slightly more extensible, but
    introduces a new schema for one item. Defer until a second
    auth-only header link actually exists (YAGNI).
  - *Conditionally include `/settings` when building the array*:
    rejected — would force `routes` to depend on signal values,
    coupling routing config to runtime state.

## R-004 — Test surface and tooling

- **Decision**: Add a new Vitest + `@testing-library/preact` test
  file (`test/us028-nav-settings-auth.test.ts`) following the
  existing pattern in `test/us017-account-ui.test.ts`. The test
  renders the app (or the Nav directly) under three auth states —
  loading, unauthenticated, authenticated — and asserts whether
  the Settings link appears in the rendered DOM via role/name
  queries (e.g. `screen.queryByRole('link', { name: /settings/i })`).
- **Rationale**: The Vitest e2e harness is already used for all
  other UI-visibility tests in this repo and supports stubbing
  fetch (used to control `/api/whoami` response). The tapzero
  suite (`test/index.ts`) is reserved for pure-function / state
  assertions and does not run a DOM, so it cannot verify the
  header markup directly.
- **Alternatives considered**:
  - *tapzero-only unit test on a small helper*: viable for the
    filter logic in isolation but does not satisfy SC-001/SC-002,
    which are stated as automated checks against the rendered
    header.
  - *Playwright end-to-end test*: overkill for a render-time DOM
    check; reserved for behaviors that need a real browser /
    network stack.

## Constraints honored

- FR-002: filter must produce DOM omission, not CSS hiding —
  satisfied by `routes.filter(...)` before the `map`.
- FR-005: no change to order, label, or visibility of any other
  header item — satisfied because the filter only removes the
  Settings entry; other entries pass through unchanged.
- CSS rule from `~/.claude/CLAUDE.md` ("NEVER change CSS that is
  not related to the task"): no CSS changes planned.

## Open questions

None remaining. All Technical Context fields are resolved.
