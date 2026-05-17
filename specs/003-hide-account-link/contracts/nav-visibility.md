# UI Contract: Header Nav — Account link visibility

**Feature**: 003-hide-account-link
**Surface**: `<header><nav aria-label="Main navigation">…</nav></header>`
**Component**: `Nav` in `src/index.ts`

This is a UI-facing contract describing the publicly observable
behavior of the site header's main navigation with respect to the
"Account" link. It is the source of truth for automated tests in
`test/us029-nav-account-auth.test.ts`.

## Inputs

| Input         | Type                | Source                       |
|---------------|---------------------|------------------------------|
| `route`       | `string`            | `state.route.value`          |
| `isAuthed`    | `boolean`           | derived from `state.auth`    |
| `authLoading` | `boolean`           | `state.authLoading.value`    |

Nothing else influences the visibility of the Account link.

## Output (rendered markup)

The nav renders an unordered list of links. Each link corresponds
to an entry in the canonical `routes` array exported from
`src/routes/index.ts`. The contract below governs only whether
the `/account` entry is included; ordering and visibility of all
other entries (including the `/settings` gating from feature 001)
are unchanged.

### C-001 — Default (loading or unauthenticated)

Given `authLoading === true` OR `isAuthed === false`:

- The rendered `<nav>` MUST NOT contain a link element whose
  `href` resolves to `/account`.
- The rendered `<nav>` MUST NOT contain an accessible name
  matching `/account/i` (case-insensitive) for the `/account`
  destination.
- All other nav entries (`/`, `/drawings`, `/pricing`,
  `/colophon`) MUST render in their existing order with their
  existing labels.
- The `/settings` entry MUST continue to be omitted under this
  state (no regression of feature 001).

### C-002 — Authenticated

Given `authLoading === false` AND `isAuthed === true`:

- The rendered `<nav>` MUST contain exactly one `<a>` element
  with `href="/account"` and visible text "Account".
- The link MUST appear in the same position relative to the
  other nav entries as it does in the canonical `routes` array
  (currently between `/pricing` and `/colophon`).
- All other nav entries MUST render unchanged, including the
  `/settings` entry which is also shown in this state.

### C-003 — Reactive updates

Within the lifetime of a single document:

- A transition from `authLoading=true → authLoading=false` with
  `isAuthed=false` MUST NOT cause the Account link to appear at
  any point (no flash).
- A transition from `isAuthed=false → isAuthed=true` MUST cause
  the Account link to appear within one Preact render cycle,
  with no manual page reload.
- A transition from `isAuthed=true → isAuthed=false` (e.g.
  logout, session expiry) MUST cause the Account link to be
  removed within one Preact render cycle.

### C-004 — DOM omission, not hiding (FR-002)

When the link is not shown, it MUST be absent from the DOM. The
contract is violated by any of the following:

- An element with `display: none` / `visibility: hidden` whose
  text or href matches Account.
- An element with `aria-hidden="true"` whose href is `/account`.
- An element rendered with the `hidden` attribute pointing at
  `/account`.

### C-005 — Symmetry with `/settings`

Account and Settings share an identical visibility rule. Any
render where Settings is present MUST also render Account, and
any render where Settings is absent MUST also omit Account. A
state in which exactly one of the two appears is a contract
violation.

## Out of scope

- Route-level access to `/account` itself (a signed-out user
  typing the URL directly). The account page's own access
  control is handled outside this contract.
- Any change to other auth-dependent header affordances
  (Login button, Logout button, avatar placeholder, stamp
  balance link).
- Mobile-specific nav drawers — none currently exist; if one is
  added later it must adopt this same contract.

## Verifying the contract

Suggested assertions (Vitest + `@testing-library/preact`):

```ts
// Loading state
expect(screen.queryByRole('link', { name: /account/i })).toBeNull()

// Anonymous state
expect(screen.queryByRole('link', { name: /account/i })).toBeNull()

// Authenticated state
expect(await screen.findByRole('link', { name: /account/i }))
    .toBeTruthy()
```

Per repo CLAUDE.md, tests MUST query by role / accessible name
and MUST NOT assert against specific text content of unrelated
header links (no brittle "Pricing" / "About" string assertions).
