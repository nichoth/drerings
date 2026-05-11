# PRD: Installable PWA + Paid-Only Share

## 1. Introduction / Overview

Drerings is a Preact SPA where users draw pictures and (on the paid
tier) save and publish them to a public URL. This PRD covers two
related additions:

1. Make the site **installable as a PWA** so users can add it to their
   home screen on iOS and Android and launch it from an app icon. Scope
   is limited to the web app manifest and supporting icons / metadata.
   No service worker is added in this round.
2. Add a **Share** action on published drawings that opens the native
   OS share sheet (so the user can pick Messages / WhatsApp / email /
   etc.). Share is **gated to paid subscribers only** — free users do
   not see the share affordance at all. The share payload is a link to
   the public post (`/post/<id>`); raw PNG sharing is out of scope for
   this round.

Background context for implementers:

- The app is a Preact SPA served by Netlify, with Functions for the
  API and an Autumn-backed paid plan (see `tasks/prd-paid-accounts-redesign.md`).
- Subscription status lives on the `users` row as `subscription_status`
  (`'free' | 'active' | 'canceled' | 'past_due'`). "Paid" for the
  purposes of this PRD means `subscription_status === 'active'`.
- Public posts already exist at `drerings.app/post/<id>` where `<id>`
  is the autoincrementing integer from `public_posts.id`.
- Reference notes on the share API live in `docs/SMS.md` and
  `docs/pwa_v_expo.md`.

## 2. Goals

- Users on iOS Safari and Android Chrome see a polished "Add to Home
  Screen" experience with a real app icon, name, and theme color.
- Once installed, launching the app from the home screen opens it in
  standalone mode (no browser chrome), feeling app-like.
- Paid subscribers viewing a published drawing can tap a Share button
  to open the native OS share sheet with a link to the public post.
- Free users see no Share button anywhere — the feature is invisible
  to them, consistent with the existing pattern where unpaid users
  cannot save or publish.
- A graceful fallback exists for browsers without
  `navigator.share({ url })` support: the user can download the PNG
  or copy the public link.

## 3. User Stories

Each story is sized for a single focused implementation session.
Stories touching UI include browser verification.

### US-001: Add web app manifest and PWA icons

**Description:** As a user on mobile, I want to install Drerings to my
home screen so it feels like a real app.

**Acceptance Criteria:**
- [ ] `public/manifest.webmanifest` exists with: `name: "Drerings"`,
      `short_name: "Drerings"`, `start_url: "/"`, `scope: "/"`,
      `display: "standalone"`, `background_color` and `theme_color`
      drawn from existing CSS variables in `_variables.css` /
      `_vars.css` (reuse existing colors — do not invent new ones).
- [ ] `icons` array references PNG icons at the standard PWA sizes:
      192x192 and 512x512 (both `purpose: "any"`), plus a 512x512
      `purpose: "maskable"` variant for Android adaptive icons.
- [ ] Icon files exist under `public/` (e.g. `public/icon-192.png`,
      `public/icon-512.png`, `public/icon-512-maskable.png`). Source
      art reuses the existing `public/icon.png` design.
- [ ] `public/index.html` includes
      `<link rel="manifest" href="/manifest.webmanifest" />`.
- [ ] `public/index.html` includes
      `<meta name="theme-color" content="..." />` matching the
      manifest `theme_color`.
- [ ] `public/index.html` includes the iOS-specific
      `<link rel="apple-touch-icon" href="/icon-192.png" />` so iOS
      uses the right home-screen icon.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill: Chrome DevTools
      "Application > Manifest" shows the manifest parsed with no
      errors, and "Installability" reports the app is installable.

### US-002: Verify install flow on iOS Safari and Android Chrome

**Description:** As a user, I want to actually install the app from
the browser and have it launch in standalone mode.

**Acceptance Criteria:**
- [ ] On Android Chrome (or Chrome DevTools mobile emulation), the
      install prompt / "Install app" menu entry is available and
      successfully installs the app.
- [ ] After install, launching from the home screen opens the app
      in standalone mode (no URL bar / browser chrome visible).
- [ ] On iOS Safari (real device or BrowserStack), "Share > Add to
      Home Screen" shows the Drerings icon and name (not a generic
      screenshot).
- [ ] Manual verification notes captured in the PR description.

### US-003: Add `share` capability flag derived from subscription status

**Description:** As a developer, I want a single source of truth for
"can this user share?" so every share UI uses the same gate.

**Acceptance Criteria:**
- [ ] A derived value (signal or selector — match the existing
      `@preact/signals` patterns in `src/state.ts`) exposes
      `canShare` as `true` only when the current user's
      `subscription_status === 'active'`.
- [ ] All share UI in this PRD reads from this single derived value.
      No component re-derives the subscription check inline.
- [ ] Typecheck and lint pass.

### US-004: Add Share button to published drawing UI (paid users only)

**Description:** As a paid user viewing one of my published
drawings, I want a Share button so I can send the link to a friend
via the OS share sheet.

**Acceptance Criteria:**
- [ ] Share button is rendered on the published-drawing UI (the
      route that displays a saved drawing the user owns — confirm
      placement with the existing `src/routes/post.ts` /
      `src/routes/send.ts` flow during implementation).
- [ ] Share button is **only rendered when `canShare` is true**.
      Free users see nothing — no disabled button, no upsell ribbon,
      no placeholder. The DOM does not include the button.
- [ ] Share button is only rendered when the drawing has been
      published (i.e. has a `public_posts.id` / public URL). If a
      paid user has saved but not yet published, the share button
      is not shown.
- [ ] Button is keyboard accessible (proper `<button>` element,
      visible focus state, `aria-label` of "Share drawing" or
      similar).
- [ ] Reuses the existing `src/components/button.ts` styles and
      patterns. No new color variables.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill: button appears for
      a mocked paid + published-drawing state, and is absent for
      free or unpublished states.

### US-005: Wire Share button to `navigator.share` with public-post URL

**Description:** As a paid user tapping Share, I want the OS share
sheet to open with a link to my public post pre-filled.

**Acceptance Criteria:**
- [ ] Click handler calls
      `navigator.share({ url, title, text })` where `url` is the
      absolute public-post URL
      (`https://drerings.app/post/<public_posts.id>` in production,
      `window.location.origin + /post/<id>` for portability across
      dev/preview).
- [ ] `title` is `"A drering for you"` (or similar — keep copy in
      one place, easy to change).
- [ ] `text` is short and human (e.g. "Check out this drering:").
      Do not duplicate the URL inside `text` — `navigator.share`
      will include the URL itself.
- [ ] The handler is gated on `navigator.canShare?.({ url })` being
      truthy. If `navigator.share` is unavailable, the fallback UI
      from US-006 is shown instead.
- [ ] `AbortError` from the user dismissing the share sheet is
      swallowed silently (no error toast). Other errors are logged
      to the console.
- [ ] Triggered by a user gesture (button click) — no programmatic
      invocation.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill: on a Chromium
      browser with `navigator.share` available, clicking Share
      opens the share sheet stub or logs the share payload.

### US-006: Add fallback UI (download PNG + copy link) for unsupported browsers

**Description:** As a paid user on a desktop browser without
`navigator.share`, I still want a useful way to send my drawing —
either by downloading the PNG or by copying the link.

**Acceptance Criteria:**
- [ ] When `navigator.share` is not available (or `canShare({ url })`
      returns false), clicking the Share button opens a small popover
      / inline panel with two actions:
        1. **Copy link** — copies the public-post URL to the
           clipboard via `navigator.clipboard.writeText`. Shows a
           transient confirmation ("Copied") next to the button.
        2. **Download PNG** — fetches the drawing PNG from Netlify
           Blobs (or re-exports from the canvas if that flow is
           already in place) and triggers a download named
           `drering-<id>.png`.
- [ ] Both actions are keyboard accessible.
- [ ] The popover / panel dismisses when focus leaves or on Escape.
- [ ] If `navigator.clipboard` is also unavailable (rare), the link
      is shown in a selectable text input as a last resort.
- [ ] Free users never see this UI — it lives inside the same paid
      gate as the Share button.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill: simulate
      `navigator.share = undefined` and confirm fallback UI works
      end-to-end.

### US-007: Update README / docs to mention installability and share

**Description:** As a future contributor, I want to know the app is
a PWA and how the share gate works without reading every file.

**Acceptance Criteria:**
- [ ] `README.md` mentions that the app is installable as a PWA and
      points to `public/manifest.webmanifest`.
- [ ] A short note in README (or in `docs/`) explains that share is
      gated to `subscription_status === 'active'` and links to
      `docs/SMS.md` for the underlying API rationale.
- [ ] No test file is added for docs (per project rule: don't write
      tests for docs).

## 4. Functional Requirements

- FR-1: The site must expose `/manifest.webmanifest` with at minimum
  `name`, `short_name`, `start_url`, `scope`, `display: "standalone"`,
  `background_color`, `theme_color`, and an `icons` array including
  192x192, 512x512, and a 512x512 maskable variant.
- FR-2: `public/index.html` must reference the manifest and include
  `theme-color` and `apple-touch-icon` link tags.
- FR-3: The app must expose a single derived `canShare` value that
  evaluates to `true` only when the signed-in user's
  `subscription_status` is `'active'`.
- FR-4: The Share button must only render in the DOM when both
  `canShare` is `true` **and** the drawing has been published
  (`public_posts.id` exists).
- FR-5: Clicking Share must call `navigator.share({ url, title, text })`
  with the absolute public-post URL when `navigator.canShare({ url })`
  is truthy.
- FR-6: When `navigator.share` is unavailable, the Share button must
  open a fallback panel offering "Copy link" (uses
  `navigator.clipboard.writeText`) and "Download PNG" (downloads the
  drawing image).
- FR-7: User-initiated abort of the share sheet (`AbortError`) must
  not surface as an error to the user.
- FR-8: All share-related logic must be triggered by user gesture
  (click) and must not run on page load.

## 5. Non-Goals (Out of Scope)

- Service worker / offline drawing / app-shell caching — explicitly
  deferred to a future PRD.
- Sharing the raw PNG file via `navigator.share({ files })`. We share
  a URL only in this round; richer file sharing can be added later.
- A custom in-app install prompt (`beforeinstallprompt` handling).
  We rely on the browser's native install UI.
- Web push notifications.
- Sharing unpublished / draft drawings.
- Showing free users an upsell when they try to share. They see no
  share UI at all in this round.
- iOS/Android app-store distribution (Expo / Capacitor wrap).
- Analytics on share clicks.

## 6. Design Considerations

- Reuse existing button styles from `src/components/button.ts` and
  associated CSS. Do not introduce a new visual button variant just
  for share.
- Reuse existing color variables from `_variables.css` / `_vars.css`
  for `theme_color` and `background_color` in the manifest. Do not
  add new color variables.
- Follow the existing nested-CSS conventions and 80-column rule.
- The Share button should sit alongside the existing actions on a
  published-drawing view (likely in `src/routes/post.ts` or
  `src/routes/send.ts` — confirm during implementation).
- Keep iconography simple — an existing share glyph or text label
  ("Share") is fine. If an SVG icon is added, follow the pattern of
  `src/components/icon-block.ts` / `icon-caution.ts`.

## 7. Technical Considerations

- The manifest is a static file under `public/` and ships as-is via
  Vite's static asset handling. No build-time generation needed.
- `subscription_status` is already on the `users` row and surfaced
  to the client through the existing session/state flow — confirm
  the exact selector during US-003 implementation rather than
  guessing the path.
- `navigator.share` requires HTTPS and a user gesture. Local dev on
  `http://127.0.0.1:8888` works because `localhost` is considered
  secure context; Netlify previews and production are HTTPS.
- Use `@preact/signals` `batch()` if multiple signals are updated
  together (per house style).
- Type style: no space between colon and type annotation; 80-column
  line limit.

## 8. Success Metrics

- App is reported as installable in Chrome DevTools Application >
  Manifest panel with no warnings.
- A paid user on a real iOS device can tap Share on a published
  drawing and the iOS share sheet opens with the public-post URL
  preselected for Messages / WhatsApp.
- A free user inspecting the same published drawing route in
  DevTools sees no `<button>` related to sharing in the DOM.
- No regression in existing routes (drawing, save, publish,
  account, pricing, login).

## 9. Open Questions

- Should the Share button live on `src/routes/post.ts` (the public
  view) only for the owner, or also on `src/routes/send.ts` /
  `drawings.ts`? Confirm during US-004 by checking which route is
  the canonical "I just published this and want to send it" surface.
- Is there an existing "drawing PNG download" helper we can reuse
  for the fallback path, or do we need to add one? Likely already
  exists somewhere in the save / publish flow — check before
  writing new code.
- Do we want to record a `shared_at` timestamp on `public_posts` for
  later analytics? Out of scope for this PRD but worth noting if it
  would change the share handler's shape.
- For the maskable icon, should we commission a new safe-zone
  rendering or crop the existing `icon.png`? Cropping is fine for
  v1; a designer pass can come later.
