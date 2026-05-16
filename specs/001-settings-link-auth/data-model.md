# Phase 1 Data Model: Auth-gated Settings link in header

**Feature**: 001-settings-link-auth  
**Date**: 2026-05-15

This feature is a pure UI gating change. It introduces no new
persisted entities, no API schema changes, and no migrations. The
"data model" here is the in-memory signal shape the Nav consumes
and the static nav-routes array it filters.

## Existing entities (reused, unchanged)

### `AuthStatus` (from `src/state.ts`)

| Field           | Type      | Meaning                              |
|-----------------|-----------|--------------------------------------|
| `registered`    | `boolean` | Whether a user has been registered   |
| `authenticated` | `boolean` | Whether the current viewer is signed in |

- **Source**: `state.auth: Signal<AuthStatus>`
- **Producer**: `State.fetchAuthStatus()` on app boot;
  `clearAuthState()` on logout / 401.
- **Consumer (new)**: `Nav` (via the derived `isAuthed`).

### Derived signal `isAuthed`

| Field      | Type                       | Meaning |
|------------|----------------------------|---------|
| `isAuthed` | `ReadonlySignal<boolean>`  | `!!state.auth.value?.authenticated` |

- **Source**: Already computed twice in the app — once on `state`
  (`state.isAuthed`) and once locally inside the `Drerings`
  component in `src/index.ts`. The new Nav filter reads this
  derived value rather than reading `state.auth` directly.

### Loading flag `authLoading`

| Field         | Type             | Meaning                          |
|---------------|------------------|----------------------------------|
| `authLoading` | `Signal<boolean>` | True while `fetchAuthStatus` is in-flight |

- **Producer**: `State.fetchAuthStatus()` (sets true at start, false in `finally`).
- **Consumer (new)**: `Nav` — uses this to suppress the Settings
  link during the initial unresolved-auth render (FR-004).

### Nav route entry (from `src/routes/index.ts`)

```ts
{ href: string; text: string }
```

| Field  | Type     | Meaning                                  |
|--------|----------|------------------------------------------|
| `href` | `string` | Path to navigate to (e.g. `/settings`)   |
| `text` | `string` | Human-readable label rendered in the nav |

- **Producer**: Hard-coded array in `src/routes/index.ts`.
- **Consumer**: `Nav` in `src/index.ts`.
- **Change**: None to the shape or to the array itself. The view
  layer filters this array; the routing layer continues to use it
  in full.

## Visibility decision (derived, not stored)

```text
showSettingsLink =
    !authLoading.value  AND  isAuthed.value
```

| Auth state                              | `authLoading` | `isAuthed` | Show Settings? |
|-----------------------------------------|---------------|------------|----------------|
| First paint, whoami in-flight           | `true`        | `false`    | NO             |
| First paint, whoami still in-flight but optimistic auth | `true` | `true` | NO  (anti-flash; FR-004) |
| Resolved, anonymous viewer              | `false`       | `false`    | NO             |
| Resolved, signed-in user                | `false`       | `true`     | YES            |
| Session expires mid-session (401)       | `false`       | `false`    | NO             |
| User signs in within the tab            | `false`       | `true`     | YES (FR-003)   |

## State transitions

No new state machines; this feature reacts to the existing
`auth` / `authLoading` signal transitions already driven by:

1. `State.fetchAuthStatus()` — initial load and explicit refresh.
2. `State.Logout()` → `clearAuthState()` — sign-out.
3. The login flow (out of scope here) — sign-in success calls
   into the same signals.

Because Preact signals re-render dependent components on change,
the Nav transitions are implicit: a change to `auth.value` or
`authLoading.value` re-runs the Nav render, which re-runs the
filter.

## Validation rules

- The Nav MUST NOT add or remove any entry other than `/settings`.
- The filter MUST evaluate `authLoading` first; if `true`, treat
  as not-authed regardless of `isAuthed`.
- The filter MUST omit the entry from the rendered list (no
  `display: none`, no `aria-hidden`).
