# Implementation Plan: Auth-gated Account link in header

**Branch**: `003-hide-account-link` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-hide-account-link/spec.md`

## Summary

Hide the "Account" link in the main site header for visitors who do
not have an active authenticated session. The link must be omitted
from the rendered markup (not just visually hidden), default to
hidden while the initial auth check is in-flight, and react to
sign-in / sign-out events within the same session without a full
page reload.

Technical approach: extend the existing `Nav` filter in
`src/index.ts` so that `/account` is filtered out of the rendered
`routes` list whenever `authLoading` is true or `isAuthed` is
false. This reuses the exact pattern already established for
`/settings` by feature 001. No backend, schema, or routing changes;
route-level access control for `/account` is explicitly out of
scope.

## Technical Context

**Language/Version**: TypeScript 5.8 (ES2022, ESM), Node >=20.19
**Primary Dependencies**: Preact 10, `@preact/signals` 2, `htm`,
`@substrate-system/routes` 5, `@substrate-system/state`, `route-event`
**Storage**: N/A (UI-only change; auth status comes from the existing
`/api/whoami` endpoint via `State.fetchAuthStatus`)
**Testing**: `@substrate-system/tapzero` + `tapout` for the bundled
tap-style suite (`npm test`); Vitest + `@testing-library/preact` for
e2e/UI tests (`npm run test:e2e`)
**Target Platform**: Modern evergreen browsers (Vite-built SPA served
from Netlify)
**Project Type**: Single-project SPA (Preact + Netlify functions);
this feature touches only the frontend
**Performance Goals**: No measurable header render regression; the
filter remains an O(n) pass over a 6-element routes array
**Constraints**: Account link MUST be omitted from the DOM (not
hidden via CSS); MUST not flash for unauthenticated viewers during
the initial `fetchAuthStatus` call; MUST NOT change the visibility
or position of any other header item
**Scale/Scope**: One component (`Nav` in `src/index.ts`), one
existing data source (`routes` in `src/routes/index.ts`); ~6 nav
items today

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The repository's `.specify/memory/constitution.md` is the unfilled
template (placeholders only). There are no ratified principles to
gate against, so this check passes by default. No complexity tracking
entries required.

## Project Structure

### Documentation (this feature)

```text
specs/003-hide-account-link/
├── plan.md              # This file (/speckit.plan command output)
├── spec.md              # Feature specification (already exists)
├── research.md          # Phase 0 output (/speckit.plan)
├── data-model.md        # Phase 1 output (/speckit.plan)
├── quickstart.md        # Phase 1 output (/speckit.plan)
├── contracts/           # Phase 1 output (/speckit.plan)
│   └── nav-visibility.md
└── tasks.md             # Phase 2 output (/speckit.tasks - NOT created here)
```

### Source Code (repository root)

```text
src/
├── index.ts                 # <-- Nav component lives here; primary edit site
├── routes/
│   ├── index.ts             # <-- `routes` array (Account entry, unchanged)
│   └── account.ts           # Account page (unchanged)
├── state.ts                 # `auth`, `authLoading`, `isAuthed` signals (unchanged)
├── components/              # Existing shared components (unchanged)
└── style.css                # No CSS change required

test/
├── index.ts                 # tapzero entry; no addition required
└── us029-nav-account-auth.test.ts   # New vitest UI test for this feature
```

**Structure Decision**: Existing single-project SPA layout. The
change is localised to one source file (`src/index.ts`) plus one
new vitest UI test. The `routes` array in `src/routes/index.ts`
stays intact so the router continues to match `/account`. No new
modules, directories, or build steps are introduced.

## Complexity Tracking

> No constitutional violations — section intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| _(none)_  | _(n/a)_    | _(n/a)_                              |
