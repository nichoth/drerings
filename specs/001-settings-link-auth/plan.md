# Implementation Plan: Auth-gated Settings link in header

**Branch**: `001-settings-link-auth` | **Date**: 2026-05-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-settings-link-auth/spec.md`

## Summary

Hide the "Settings" link in the main site header for visitors who do
not have an active authenticated session. The link must be omitted
from the rendered markup (not just visually hidden), default to
hidden while the initial auth check is in-flight, and react to
sign-in / sign-out events within the same session without a full
page reload.

Technical approach: pass the existing `isAuthed` and `authLoading`
signals from `src/index.ts` into the `Nav` component, and filter
`/settings` out of the `routes` list it renders unless the viewer is
authenticated and the auth check has resolved. No backend, schema,
or routing changes; route-level access control for `/settings` is
explicitly out of scope.

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
filter is an O(n) pass over a 6-element routes array  
**Constraints**: Settings link MUST be omitted from the DOM (not
hidden via CSS); MUST not flash for unauthenticated viewers during
the initial `fetchAuthStatus` call  
**Scale/Scope**: One component (`Nav` in `src/index.ts`), one data
source (`routes` in `src/routes/index.ts`); ~6 nav items today

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The repository's `.specify/memory/constitution.md` is the unfilled
template (placeholders only). There are no ratified principles to
gate against, so this check passes by default. No complexity tracking
entries required.

## Project Structure

### Documentation (this feature)

```text
specs/001-settings-link-auth/
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
│   ├── index.ts             # <-- `routes` array (Settings entry)
│   └── settings.ts          # Settings page (unchanged)
├── state.ts                 # `auth`, `authLoading`, `isAuthed` signals (unchanged)
├── components/              # Existing shared components (unchanged)
└── style.css                # No CSS change required

test/
├── index.ts                 # tapzero entry; may add a Nav filter unit assertion
└── us028-nav-settings-auth.test.ts   # New vitest UI test for this feature
```

**Structure Decision**: Existing single-project SPA layout. The
change is localised to two source files (`src/index.ts`,
`src/routes/index.ts`) plus one new vitest UI test. No new modules,
directories, or build steps are introduced.

## Complexity Tracking

> No constitutional violations — section intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| _(none)_  | _(n/a)_    | _(n/a)_                              |
