# UI Contract: Header Nav — Settings link visibility

**Feature**: 001-settings-link-auth  
**Surface**: `<header><nav aria-label="Main navigation">…</nav></header>`  
**Component**: `Nav` in `src/index.ts`

This is a UI-facing contract describing the publicly observable
behavior of the site header's main navigation with respect to the
"Settings" link. It is the source of truth for automated tests in
`test/us028-nav-settings-auth.test.ts`.

## Inputs

| Input         | Type                | Source                       |
|---------------|---------------------|------------------------------|
| `route`       | `string`            | `state.route.value`          |
| `isAuthed`    | `boolean`           | derived from `state.auth`    |
| `authLoading` | `boolean`           | `state.authLoading.value`    |

Nothing else influences the visibility of the Settings link.

## Output (rendered markup)

The nav renders an unordered list of links. Each link corresponds
to an entry in the canonical `routes` array exported from
`src/routes/index.ts`. The contract below governs only whether
the `/settings` entry is included; ordering of all other entries
is unchanged.

### C-001 — Default (loading or unauthenticated)

Given `authLoading === true` OR `isAuthed === false`:

- The rendered `<nav>` MUST NOT contain a link element whose
  `href` resolves to `/settings`.
- The rendered `<nav>` MUST NOT contain an accessible name
  matching `/settings/i` (case-insensitive) for the
  `/settings` destination.
- All other nav entries (`/`, `/drawings`, `/pricing`,
  `/account`, `/colophon`) MUST render in their existing order
  with their existing labels.

### C-002 — Authenticated

Given `authLoading === false` AND `isAuthed === true`:

- The rendered `<nav>` MUST contain exactly one `<a>` element
  with `href="/settings"` and visible text "Settings".
- The link MUST appear in the same position relative to the
  other nav entries as it does in the canonical `routes`
  array (currently last).
- All other nav entries MUST render unchanged.

### C-003 — Reactive updates

Within the lifetime of a single document:

- A transition from `authLoading=true → authLoading=false` with
  `isAuthed=false` MUST NOT cause the Settings link to appear at
  any point (no flash).
- A transition from `isAuthed=false → isAuthed=true` MUST cause
  the Settings link to appear within one Preact render cycle,
  with no manual page reload.
- A transition from `isAuthed=true → isAuthed=false` (e.g.
  logout, session expiry) MUST cause the Settings link to be
  removed within one Preact render cycle.

### C-004 — DOM omission, not hiding (FR-002)

When the link is not shown, it MUST be absent from the DOM. The
contract is violated by any of the following:

- An element with `display: none` / `visibility: hidden` whose
  text or href matches Settings.
- An element with `aria-hidden="true"` whose href is
  `/settings`.
- An element rendered with `hidden` attribute pointing at
  `/settings`.

## Out of scope

- Route-level access to `/settings` itself (a signed-out user
  typing the URL directly). The settings page's own access
  control is handled outside this contract.
- Any change to other auth-dependent header affordances
  (Login button, Logout button, avatar placeholder).
- Mobile-specific nav drawers — none currently exist; if one is
  added later it must adopt this same contract.

## Verifying the contract

Suggested assertions (Vitest + `@testing-library/preact`):

```ts
// Loading state
expect(screen.queryByRole('link', { name: /settings/i })).toBeNull()

// Anonymous state
expect(screen.queryByRole('link', { name: /settings/i })).toBeNull()

// Authenticated state
expect(await screen.findByRole('link', { name: /settings/i }))
    .toBeTruthy()
```

Per repo CLAUDE.md, tests MUST query by role / accessible name and
MUST NOT assert against specific text content of unrelated header
links (no brittle "Pricing" / "About" string assertions).
