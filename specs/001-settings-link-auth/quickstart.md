# Quickstart: Auth-gated Settings link in header

**Feature**: 001-settings-link-auth  
**Branch**: `001-settings-link-auth`

A pure UI-gating change. No backend, no schema, no env vars. Two
source files change; one new test file is added.

## Prerequisites

- Node `>=20.19.0` (per `package.json` engines)
- `npm install` already run
- Working tree on branch `001-settings-link-auth`

## Run the app locally

```sh
npm start
# concurrently starts Netlify functions on :9999 and Vite on the
# default dev port. The browser app talks to /api/whoami for auth.
```

## Manual smoke test (matches the three spec user stories)

1. **US-1 (anonymous)** — open the site in a fresh private window
   (no cookies). Header MUST show: Home, Drawings, Pricing,
   Account, About, Login. No Settings link.
2. **US-2 (signed in)** — sign in via the login flow. After the
   header re-renders (no manual reload), the Settings link MUST
   appear in the same position it did before this change (last
   nav item, before the Logout button).
3. **US-3 (state change in-session)** — while signed in, click
   Logout. Settings disappears from the header without reload.
   Sign back in: Settings reappears.

The acceptance checks for FR-002 / SC-001 (DOM omission, not
visual hiding) can be confirmed in DevTools: with no session,
`document.querySelector('nav a[href="/settings"]')` returns
`null`.

## Run the automated checks

```sh
# tapzero suite (pure logic; no DOM)
npm test

# vitest UI suite (new test added by this feature lives here)
npm run test:e2e -- us028-nav-settings-auth

# lint (matches repo eslint config; do not modify)
npm run lint
```

The new test file is `test/us028-nav-settings-auth.test.ts`. It
mocks `fetch('/api/whoami')` to drive the three contract states
defined in `contracts/nav-visibility.md` (C-001, C-002, C-003)
and asserts visibility via role/name queries.

## What changes in source

- `src/index.ts` — `Nav` accepts `isAuthed` and `authLoading`
  signals (or their boolean values) and filters `/settings` from
  the rendered list when either condition disqualifies it. Pass
  the existing local `isAuthed` and `state.authLoading` from
  `Drerings`.
- `src/routes/index.ts` — unchanged; `routes` keeps all six
  entries so the router still matches `/settings`.
- `test/us028-nav-settings-auth.test.ts` — new.

No CSS changes. No changes to other header items.

## Rollback

Pure render-time gating; rollback is `git revert` of the
implementation commit. No data or schema state to migrate back.
