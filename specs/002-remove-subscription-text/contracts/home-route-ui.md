# UI Contract — Home Route (`/`)

This document captures the externally observable contract of the home route
that this feature changes. The home route is a Preact view rendered by
`src/routes/home.ts` and is the user-facing "interface" the feature modifies.

## Scope

Only the rendered DOM and accessibility tree of `/` are in scope. No
HTTP/API contracts change.

## Required absences (new, this feature)

After this feature ships, for **every** rendering of `/` — signed-out,
signed-in non-paid, and signed-in paid:

1. The string `Drawings aren't saved without a subscription` MUST NOT
   appear in the rendered DOM of the home route.
2. The string `Subscribe to keep them and share them with the world`
   MUST NOT appear in the rendered DOM of the home route.
3. No element with `class="free-account-warning"` MUST exist on `/`.
4. No element with `role="status"` and `aria-label="Save warning"` MUST
   exist in the accessibility tree of `/`.
5. No anchor whose `href` is `/pricing` MUST exist on `/` as part of the
   removed banner. (Other `/pricing` links elsewhere in the app — e.g.,
   navigation, account page — are out of scope and may remain.)

## Preserved behavior (existing, must not regress)

Rendering `/` MUST still produce, for all user states:

- The intro paragraph: `Draw things, then show people the drawings.`
- The `<canvas id="sketchpad">` element inside `.composer-layout >
  .canvas-column`.
- The post `<form>` with its text `<textarea>` (id `text`) and existing
  controls.
- All paid-vs-free conditional rendering for features *other than* the
  removed banner (e.g., paid drawing controls remain gated by
  `state.isPaid` as they are today).

## Acceptance test outline (manual)

See `quickstart.md` for the executable verification steps. Automated
text-content assertions are intentionally *not* added (project rule:
no brittle tests on specific HTML text).
