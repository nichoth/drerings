# Quickstart: Auth-gated Account link in header

**Feature**: 003-hide-account-link
**Branch**: `003-hide-account-link`

A pure UI-gating change. No backend, no schema, no env vars. One
source file changes; one new test file is added.

## Prerequisites

- Node `>=20.19.0` (per `package.json` engines)
- `npm install` already run
- Working tree on branch `003-hide-account-link`

## Run the app locally

```sh
npm start
# concurrently starts Netlify functions on :9999 and Vite on the
# default dev port. The browser app talks to /api/whoami for auth.
```

## Manual smoke test (matches the three spec user stories)

1. **US-1 (anonymous)** — open the site in a fresh private window
   (no cookies). Header MUST show: Home, Drawings, Pricing, About,
   Login. No Account link, no Settings link.
2. **US-2 (signed in)** — sign in via the login flow. After the
   header re-renders (no manual reload), the Account link MUST
   appear in the same position it did before this change (between
   Pricing and About, with Settings still last).
3. **US-3 (state change in-session)** — while signed in, click
   Logout. Account disappears from the header without reload
   (Settings disappears too, as before). Sign back in: both
   reappear.

The acceptance checks for FR-002 / SC-001 (DOM omission, not
visual hiding) can be confirmed in DevTools: with no session,
`document.querySelector('nav a[href="/account"]')` returns
`null`.

## Run the automated checks

```sh
# tapzero suite (pure logic; no DOM)
npm test

# vitest UI suite (new test added by this feature lives here)
npm run test:e2e -- us029-nav-account-auth

# lint (matches repo eslint config; do not modify)
npm run lint
```

The new test file is `test/us029-nav-account-auth.test.ts`. It
mounts the `Nav` component directly under the three contract
states defined in `contracts/nav-visibility.md` (C-001, C-002,
C-003) and asserts visibility via role/name queries. The pattern
mirrors `test/us028-nav-settings-auth.test.ts` from feature 001.

## What changes in source

- `src/index.ts` — `Nav`'s existing `routes.filter(...)` predicate
  is extended so that `/account`, like `/settings`, is dropped
  when `authLoading || !isAuthed`. No prop changes; `Nav` already
  receives `isAuthed` and `authLoading`.
- `src/routes/index.ts` — unchanged; `routes` keeps all six
  entries so the router still matches `/account`.
- `test/us029-nav-account-auth.test.ts` — new.

No CSS changes. No changes to other header items.

## Rollback

Pure render-time gating; rollback is `git revert` of the
implementation commit. No data or schema state to migrate back.
