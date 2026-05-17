# Phase 1 Data Model: Auth-gated Account link in header

**Feature**: 003-hide-account-link
**Date**: 2026-05-16

This feature is a pure UI gating change. It introduces no new
persisted entities, no API schema changes, and no migrations. The
"data model" here is the in-memory signal shape the `Nav` consumes
and the static nav-routes array it filters.

## Existing entities (reused, unchanged)

### `AuthStatus` (from `src/state.ts`)

| Field           | Type      | Meaning                                  |
|-----------------|-----------|------------------------------------------|
| `registered`    | `boolean` | Whether a user has been registered       |
| `authenticated` | `boolean` | Whether the current viewer is signed in  |

- **Source**: `state.auth: Signal<AuthStatus>`
- **Producer**: `State.fetchAuthStatus()` on app boot;
  `clearAuthState()` on logout / 401.
- **Consumer (extended)**: `Nav` — already reads this via the
  `isAuthed` prop for the `/settings` filter (feature 001); the
  same prop now also gates `/account`.

### Derived value `isAuthed`

| Field      | Type      | Meaning                                |
|------------|-----------|----------------------------------------|
| `isAuthed` | `boolean` | `!!state.auth.value?.authenticated`    |

- **Source**: Computed in `src/index.ts` inside the `Drerings`
  component via `useComputed`, then passed to `Nav` as a plain
  boolean prop.
- **Change**: None to the value; one new consumer site (the
  `/account` entry in the existing Nav filter predicate).

### Loading flag `authLoading`

| Field         | Type              | Meaning                          |
|---------------|-------------------|----------------------------------|
| `authLoading` | `Signal<boolean>` | True while `fetchAuthStatus` is in-flight |

- **Producer**: `State.fetchAuthStatus()` (sets true at start,
  false in `finally`).
- **Consumer (extended)**: `Nav` — already gates `/settings` on
  this flag; the same flag now also gates `/account` so the link
  never flashes for anonymous visitors during the initial whoami
  request (FR-004).

### Nav route entry (from `src/routes/index.ts`)

```ts
{ href: string; text: string }
```

| Field  | Type     | Meaning                                  |
|--------|----------|------------------------------------------|
| `href` | `string` | Path to navigate to (e.g. `/account`)    |
| `text` | `string` | Human-readable label rendered in the nav |

- **Producer**: Hard-coded array in `src/routes/index.ts`.
- **Consumer**: `Nav` in `src/index.ts`.
- **Change**: None to the shape or to the array itself. Both
  `/account` and `/settings` remain in the array; only the view
  layer's render predicate changes.

## Visibility decision (derived, not stored)

```text
showAccountLink =
    !authLoading.value  AND  isAuthed.value
```

This is the same predicate already used for `/settings`. The
implementation collapses both auth-only entries into a single
check (either a shared predicate function, or an array of
auth-only hrefs that the filter consults).

| Auth state                                              | `authLoading` | `isAuthed` | Show Account? |
|---------------------------------------------------------|---------------|------------|---------------|
| First paint, whoami in-flight                           | `true`        | `false`    | NO            |
| First paint, whoami still in-flight but optimistic auth | `true`        | `true`     | NO (anti-flash; FR-004) |
| Resolved, anonymous viewer                              | `false`       | `false`    | NO            |
| Resolved, signed-in user                                | `false`       | `true`     | YES           |
| Session expires mid-session (401)                       | `false`       | `false`    | NO            |
| User signs in within the tab                            | `false`       | `true`     | YES (FR-003)  |

## State transitions

No new state machines; this feature reacts to the existing
`auth` / `authLoading` signal transitions already driven by:

1. `State.fetchAuthStatus()` — initial load and explicit refresh.
2. `State.Logout()` → `clearAuthState()` — sign-out.
3. The login flow (out of scope here) — sign-in success calls
   into the same signals.

Because Preact signals re-render dependent components on change,
the Nav transitions are implicit: any change to `auth.value` or
`authLoading.value` re-runs the Nav render, which re-runs the
filter, which adds or removes both auth-only links atomically.

## Validation rules

- The Nav MUST NOT add or remove any entry other than `/settings`
  and `/account`.
- The filter MUST evaluate `authLoading` first; if `true`, treat
  as not-authed regardless of `isAuthed` for both auth-only
  entries.
- The filter MUST omit each auth-only entry from the rendered
  list (no `display: none`, no `aria-hidden`, no `hidden`).
- When `isAuthed && !authLoading`, both auth-only links MUST
  render together; neither MUST appear without the other.
