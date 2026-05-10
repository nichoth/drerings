# PRD: Paid Accounts + Netlify Backend Redesign

## 1. Introduction / Overview

drerings.app is currently a free drawing tool that uses Bluesky as a
backend for posting. This redesign turns it into a small paid product:

- The Bluesky/AT Proto backend is removed entirely. The app's backend
  becomes Netlify-only: Netlify Functions for the API, Netlify Blobs
  for drawing images, and Netlify DB for users, drawings, and public
  posts.
- A paid tier ($5/month, billed via Autumn) unlocks the ability to
  *save* drawings and to *publish* them to a public URL like
  `drerings.app/post/6`.
- Free users can still open the app and draw, but their drawing is held
  only in memory — refreshing or closing the tab loses it. They cannot
  save or share.
- Authentication switches to passkey or magic link (delivered via a
  separate Resend account the user will provision).
- Required legal pages (`/privacy`, `/terms`) are added.

This is a clean cutover. No existing Bluesky data is migrated.

## 2. Goals

- Replace the AT Proto / Bluesky backend with a Netlify-only stack.
- Introduce a single paid plan ($5/month) gated by Autumn subscription
  status.
- Allow paid users to save drawings (image + text + alt text) and to
  publish them to a stable public URL keyed by a global sequential
  integer ID.
- Keep the free experience usable as a "try it" surface that drives
  upgrades, without offering persistence or sharing.
- Ship the legal pages and account-management surfaces required to
  responsibly take payment.

## 3. User Stories

Stories are sized for a single focused implementation session. Stories
that touch UI include browser verification in their acceptance
criteria.

### US-001: Remove Bluesky / AT Proto dependencies

**Description:** As a developer, I want all Bluesky/AT Proto code and
dependencies removed so the app has a single clean backend story.

**Acceptance Criteria:**
- [ ] `@atproto/api`, `@atproto/identity`, `@atproto/oauth-client`,
      `@atproto/oauth-client-browser`, `@atproto/oauth-client-node`
      removed from `package.json`.
- [ ] All AT Proto imports and call sites removed from `src/` and
      `netlify/functions/`.
- [ ] Old Bluesky-specific routes (e.g. AT-Proto login/callback) and
      components deleted.
- [ ] App boots and renders the home route with no console errors.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

### US-002: Provision Netlify DB schema (users, drawings, public_posts)

**Description:** As a developer, I need persistent tables for users,
saved drawings, and public posts so the rest of the feature can be
built on stable storage.

**Acceptance Criteria:**
- [ ] `users` table: `id` (PK), `email` (unique), `created_at`,
      `subscription_status` (`'free' | 'active' | 'canceled' |
      'past_due'`), `autumn_customer_id` (nullable).
- [ ] `passkeys` table: `id`, `user_id` (FK), `credential_id`,
      `public_key`, `counter`, `created_at`.
- [ ] `magic_link_tokens` table: `token` (PK), `user_id` (FK),
      `expires_at`, `used_at`.
- [ ] `drawings` table: `id` (PK, uuid), `user_id` (FK),
      `blob_key` (string), `text` (string), `alt_text` (string),
      `created_at`, `updated_at`.
- [ ] `public_posts` table: `id` (BIGSERIAL / autoincrementing
      integer PK — this is the number that appears in the URL),
      `drawing_id` (FK, unique), `published_at`.
- [ ] Migration runs cleanly against a fresh DB.
- [ ] Typecheck passes.

### US-003: Configure Netlify Blobs store for drawing images

**Description:** As a developer, I need a configured blob store and
helper functions to put/get/delete drawing images so the API can
persist images outside the DB.

**Acceptance Criteria:**
- [ ] A named blob store (`drawings`) is configured.
- [ ] `putDrawingImage(userId, drawingId, blob)` writes the image and
      returns a stable `blob_key`.
- [ ] `getDrawingImage(blob_key)` returns the image bytes (or 404).
- [ ] `deleteDrawingImage(blob_key)` removes it.
- [ ] Typecheck passes.

### US-004: Magic-link auth via Resend

**Description:** As a user, I want to sign in with a one-time link
emailed to me so I don't need a password.

**Acceptance Criteria:**
- [ ] `POST /api/auth/magic-link` accepts an email, creates a
      single-use token (15-minute expiry), and sends the link via
      Resend.
- [ ] `GET /api/auth/magic-link/callback?token=…` validates the
      token, marks it `used_at`, creates the user if needed, and
      issues a session cookie (httpOnly, Secure, SameSite=Lax).
- [ ] Login route in the SPA has a single email input, a "Send link"
      button, and a "check your email" success state.
- [ ] Reused/expired tokens return a clear error page.
- [ ] Resend API key is read from a Netlify env var; no key in the
      repo.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

### US-005: Passkey registration and sign-in

**Description:** As a logged-in user, I want to register a passkey
and use it on subsequent visits so I don't have to wait for an email.

**Acceptance Criteria:**
- [ ] `POST /api/auth/passkey/register/options` and
      `/register/verify` implement WebAuthn registration using
      `@simplewebauthn/server` + `@simplewebauthn/browser`.
- [ ] `POST /api/auth/passkey/login/options` and `/login/verify`
      implement WebAuthn authentication and issue a session cookie
      on success.
- [ ] Settings page has a "Register a passkey" button (visible only
      when logged in).
- [ ] Login page has a "Sign in with passkey" affordance in addition
      to the magic-link form.
- [ ] Browsers without passkey support fall back gracefully to
      magic link only (no broken UI).
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

### US-006: Session middleware + `whoami` endpoint

**Description:** As a developer, I need a single helper that resolves
the current user from the session cookie so every API function can
authorize requests consistently.

**Acceptance Criteria:**
- [ ] `getSession(request)` returns `{ user } | null`.
- [ ] `GET /api/whoami` returns `{ id, email, subscription_status }`
      or `401`.
- [ ] Frontend has a `currentUser` signal populated on app boot from
      `/api/whoami`.
- [ ] Typecheck passes.

### US-007: Free-user drawing experience (in-memory only)

**Description:** As a free or anonymous user, I want to open the app
and draw, but I should be clearly told that my work won't be saved.

**Acceptance Criteria:**
- [ ] Home route loads the canvas without requiring login.
- [ ] No `localStorage` or backend persistence of the drawing.
- [ ] A small persistent banner or hint reads roughly: "Drawings
      aren't saved on free accounts — upgrade to keep them," with a
      link to the pricing page.
- [ ] "Save" and "Send It" controls are disabled with a tooltip
      explaining why and a link to the pricing page.
- [ ] Refreshing the page clears the canvas (expected behavior).
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

### US-008: Save drawing API (paid)

**Description:** As a paid user, I want to save my current drawing
(image + text + alt text) so I can come back to it later.

**Acceptance Criteria:**
- [ ] `POST /api/drawings` accepts `{ image (binary or base64),
      text, alt_text }`, requires an active subscription, writes the
      image to Netlify Blobs, and inserts a `drawings` row.
- [ ] Returns `{ id, created_at }` on success.
- [ ] Returns `401` for unauthenticated, `402` for free accounts.
- [ ] `PUT /api/drawings/:id` updates an existing drawing (image
      replace allowed; previous blob deleted).
- [ ] Typecheck and lint pass.

### US-009: Save / load drawing UI (paid)

**Description:** As a paid user, I want a Save button on the canvas
and a list of my saved drawings I can reopen.

**Acceptance Criteria:**
- [ ] "Save" button on the canvas page is enabled for paid users
      and POSTs to `/api/drawings`.
- [ ] A `/drawings` route lists the user's saved drawings (thumbnail,
      text excerpt, updated_at, "Open" + "Delete" actions).
- [ ] Opening a drawing loads its image and text back into the canvas
      for further editing.
- [ ] Save shows a clear success state; failure shows an inline error.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

### US-010: Delete a saved drawing (paid)

**Description:** As a paid user, I want to delete a saved drawing
(and its blob) from my list.

**Acceptance Criteria:**
- [ ] `DELETE /api/drawings/:id` removes the row, deletes the blob,
      and (if the drawing has a `public_posts` row) also deletes the
      public post.
- [ ] Delete button on `/drawings` shows a confirm dialog before
      acting.
- [ ] List updates immediately on success.
- [ ] Returns `401`/`403` if not the owner.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

### US-011: "Send It" confirmation route + publish API (paid)

**Description:** As a paid user, I want a "Send It" button that takes
me to a confirmation screen, then publishes my drawing to a public
URL.

**Acceptance Criteria:**
- [ ] "Send It" button on the canvas (and on each drawing in
      `/drawings`) navigates to `/send/:drawingId` (client-side
      route).
- [ ] `/send/:drawingId` shows a preview (image, text, alt text) and
      a "Publish" button. Owner-only.
- [ ] Clicking "Publish" calls `POST /api/posts` with `{ drawing_id }`,
      which inserts a `public_posts` row (autoincrementing `id`) and
      returns `{ id }`.
- [ ] On success, redirect to `/post/:id`.
- [ ] If the drawing already has a `public_posts` row, the publish
      action is a no-op and just redirects to the existing post URL.
- [ ] Returns `401` / `402` / `403` as appropriate.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

### US-012: Public post page `/post/:id`

**Description:** As any visitor (logged in or not), I want to view
a published drawing at a stable URL.

**Acceptance Criteria:**
- [ ] Client-side route `/post/:id` fetches `GET /api/posts/:id` and
      renders the image, text, and alt text. No author display, no
      reactions, no comments.
- [ ] `<img>` uses the drawing's alt text as its `alt` attribute.
- [ ] Page sets appropriate `<title>` and meta tags (Open Graph
      image + title) for link previews.
- [ ] Unknown ID returns a 404 view.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

### US-013: Pricing page + paywall CTA

**Description:** As a visitor, I want a pricing page that explains
the $5/month plan and lets me start checkout.

**Acceptance Criteria:**
- [ ] `/pricing` route describes the free vs. paid tiers and shows
      "Subscribe — $5/month".
- [ ] Disabled "Save" / "Send It" buttons across the app link to
      `/pricing`.
- [ ] If the user is logged out, the pricing page prompts sign-in
      before checkout.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

### US-014: Autumn checkout integration

**Description:** As a logged-in free user, I want to subscribe via
Autumn so I can unlock paid features.

**Acceptance Criteria:**
- [ ] `POST /api/billing/checkout` creates an Autumn checkout
      session for the current user and returns the checkout URL.
- [ ] "Subscribe" button on `/pricing` calls that endpoint and
      redirects the browser to the returned URL.
- [ ] On return from Autumn, the user lands on `/account?status=ok`
      (or `?status=cancel` on cancel).
- [ ] Autumn customer id is persisted on the `users` row.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill (mocked Autumn in
      dev is acceptable; document the env vars needed for the live
      flow).

### US-015: Autumn webhook → subscription status

**Description:** As a developer, I want subscription state in our DB
to stay in sync with Autumn so gating decisions are correct.

**Acceptance Criteria:**
- [ ] `POST /api/billing/webhook` validates Autumn's signature header.
- [ ] Handles at minimum: subscription created/activated → `active`;
      canceled → `canceled`; payment failed → `past_due`; renewed →
      `active`.
- [ ] Updates `users.subscription_status` and (if needed) stored
      Autumn ids.
- [ ] Returns `200` for handled events, `400` for invalid signature.
- [ ] Webhook endpoint is reachable from Autumn (configured in
      `netlify.toml` / Autumn dashboard — documented in README).
- [ ] Typecheck and lint pass.

### US-016: Paid-feature gating helper

**Description:** As a developer, I need one place that decides
whether a user is "paid" so the UI and the API stay consistent.

**Acceptance Criteria:**
- [ ] `isPaid(user)` returns `true` only for `subscription_status ===
      'active'` (canceled users keep access until period end — see
      open question OQ-2).
- [ ] All API endpoints that require payment use this helper and
      return `402 Payment Required` on failure.
- [ ] Frontend has a `isPaid` derived signal used to gate UI.
- [ ] Typecheck passes.

### US-017: Account / settings page

**Description:** As a user, I want one page where I can manage my
email, passkey, subscription, and account.

**Acceptance Criteria:**
- [ ] `/account` route shows: current email, subscription status
      ("Free" / "Active — renews YYYY-MM-DD" / "Canceled — ends
      YYYY-MM-DD" / "Past due"), passkey list with "Register new
      passkey" and "Remove" actions.
- [ ] "Update email" flow: enter new email → magic link sent to new
      address → on confirm, update `users.email`.
- [ ] "Cancel subscription" button hits `POST /api/billing/cancel`
      which calls Autumn's cancel-at-period-end API. UI updates to
      show "Canceled — ends YYYY-MM-DD".
- [ ] "Delete account" button shows a confirm dialog ("Type DELETE
      to confirm"). On confirm, hits `DELETE /api/account` which
      cancels Autumn subscription, deletes all the user's drawings
      + blobs + public_posts, then deletes the user row, then logs
      out.
- [ ] All destructive actions require an active session.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

### US-018: Logout

**Description:** As a logged-in user, I want a logout control that
clears my session.

**Acceptance Criteria:**
- [ ] `POST /api/auth/logout` clears the session cookie.
- [ ] Logout link is visible in the app header when logged in.
- [ ] After logout, protected routes redirect to `/login`.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

### US-019: Legal pages (`/privacy`, `/terms`)

**Description:** As a paying customer, I want to read the privacy
policy and terms of service before subscribing.

**Acceptance Criteria:**
- [ ] `/privacy` and `/terms` are real client-side routes with
      readable, plain-language content covering the data we collect
      (email, drawings, payment metadata via Autumn), how it's used,
      retention, deletion, and contact info.
- [ ] Footer (or pricing/checkout flow) links to both pages.
- [ ] Both pages are crawlable (server-rendered or pre-rendered HTML
      acceptable; at minimum a meaningful `<title>` and meta
      description).
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

### US-020: README / deployment notes

**Description:** As a developer (or future me), I need to know which
env vars and dashboards to configure to run this in production.

**Acceptance Criteria:**
- [ ] README documents required env vars: `RESEND_API_KEY`,
      `AUTUMN_API_KEY`, `AUTUMN_WEBHOOK_SECRET`, session secret,
      Netlify DB connection, Netlify Blobs store name, app base URL.
- [ ] README documents how to point Autumn webhooks at the deployed
      function URL.
- [ ] README documents the local dev story (mock Autumn / Resend if
      keys are absent).

## 4. Functional Requirements

- FR-1: The system must remove all Bluesky / AT Proto code and
  dependencies; no AT Proto traffic shall leave the app.
- FR-2: The backend must use Netlify Functions, Netlify Blobs (for
  drawing images), and Netlify DB (for users, drawings, public
  posts).
- FR-3: Authentication must support two methods: WebAuthn passkeys
  and magic links delivered via Resend.
- FR-4: The system must distinguish three subscription states for
  users: `free`, `active`, `canceled` (with end date), `past_due`.
- FR-5: Free users must be able to use the canvas in-memory only.
  The system must not persist their drawing to localStorage or to
  the backend.
- FR-6: Paid (`active`) users must be able to save drawings,
  consisting of an image (in Netlify Blobs), display text, and alt
  text (both in Netlify DB).
- FR-7: Paid users must be able to publish a saved drawing via a
  "Send It" button that navigates to `/send/:drawingId`. Confirming
  on that page creates a `public_posts` row and redirects to
  `/post/:id`.
- FR-8: Public post IDs must be a globally unique, autoincrementing
  integer used directly in the URL (`/post/6`).
- FR-9: A given drawing must have at most one corresponding
  `public_posts` row. Re-publishing returns the existing post URL.
- FR-10: The `/post/:id` page must render the image (with the alt
  text as the `<img alt>` attribute) and the post's text. It must
  not show author identity, reactions, or comments.
- FR-11: Save and "Send It" UI controls must be disabled for free
  and anonymous users, with a visible link to `/pricing`.
- FR-12: All paid-feature API endpoints must return `402 Payment
  Required` when called by a non-paid user.
- FR-13: Subscriptions must be processed via Autumn at $5/month
  (USD). The system must persist `autumn_customer_id` on the user
  row and reconcile subscription status via Autumn webhooks.
- FR-14: Users must be able to cancel their subscription from
  `/account`. Cancellation must use Autumn's cancel-at-period-end
  semantics; the user retains paid access until the period ends.
- FR-15: Users must be able to delete an individual saved drawing
  (and its blob, and any associated public post).
- FR-16: Users must be able to delete their account from `/account`.
  Account deletion must remove all their drawings, blobs, public
  posts, passkeys, and the user row, and must cancel any active
  subscription via Autumn.
- FR-17: Users must be able to update the email on their account
  via a magic-link confirmation to the new address.
- FR-18: The site must include `/privacy` and `/terms` pages,
  linked from the footer or checkout flow.
- FR-19: Sessions must be carried in an httpOnly, Secure,
  SameSite=Lax cookie. Magic-link tokens must be single-use and
  expire within 15 minutes.
- FR-20: Secrets (Resend, Autumn, session signing key, DB
  credentials) must be read from Netlify environment variables and
  must not be checked into the repo.

## 5. Non-Goals (Out of Scope)

- No public feed or `/posts` index page. Public posts are
  reachable only by direct URL.
- No comments, likes, follows, profiles, or any social graph.
- No author display on `/post/:id`.
- No editing of a public post after it is published. (Edits to the
  underlying drawing are out of scope for v1; adding them later is
  fine but would require a decision about whether the public URL
  reflects edits.)
- No drafts list beyond "saved drawings."
- No team / multi-seat plans.
- No annual plan, free trial, or discount codes at launch.
- No migration of existing Bluesky-backed posts or users.
- No mobile app.
- No analytics or third-party tracking beyond what's strictly needed
  for billing.
- No admin UI for moderating public posts.
- No email notifications other than auth (magic links + email-change
  confirmation). No "your subscription renewed" emails — Autumn's
  defaults are sufficient.

## 6. Design Considerations

- Reuse the existing canvas / drawing surface and toolbar; this
  redesign is mostly backend, auth, and gating.
- The "Save" and "Send It" buttons should sit together in the
  existing canvas action area. Disabled state should be visually
  distinct and the tooltip / inline copy should make the upgrade
  path obvious.
- `/pricing`, `/account`, `/login`, `/privacy`, `/terms`, `/send/:id`,
  `/post/:id`, `/drawings` are all new client-side routes. Follow
  the existing `src/routes/` convention (one folder per route with
  `*.ts` + `*.css`).
- Use the existing component primitives where possible
  (`@substrate-system/dialog`, `@substrate-system/input`, etc.).
- Continue using `@preact/signals` for state, with `batch()` when
  setting multiple signals together (per repo conventions).
- The header should expose: app name (left), and on the right:
  either "Sign in" (logged out) or a small menu with "Saved
  drawings", "Account", "Logout" (logged in).

## 7. Technical Considerations

- **Auth library:** `@simplewebauthn/server` on the function side,
  `@simplewebauthn/browser` (already a dep) on the client.
- **Email:** Resend SDK called from `netlify/functions`. The user
  will provision a separate Resend account/key for this app.
- **Payments:** Autumn checkout + webhooks. We need a documented
  approach for verifying webhook signatures (consult Autumn docs
  during US-015).
- **Netlify Blobs:** use `@netlify/blobs` from functions. Blob keys
  should be unguessable (e.g. `${userId}/${drawingId}`).
- **Netlify DB:** use whatever ORM/driver we settle on (likely
  Neon's Postgres driver since Netlify DB is Neon). Migrations
  should live in the repo.
- **Sessions:** prefer signed, opaque session ids stored in DB
  (revocable on logout / account deletion) over stateless JWTs, so
  account deletion immediately invalidates outstanding sessions.
- **CORS / origin:** functions should only accept requests from the
  app's own origin.
- **Image format / size:** decide (and document) a max image size
  and accepted format for the saved drawing payload. Reject
  oversized uploads server-side.
- **Rate limiting:** at minimum, rate-limit magic-link requests by
  IP + email to avoid abuse of the Resend account.
- **Local dev:** `npm start` already runs `ntl functions:serve` +
  `vite`. Document any new env vars in `.env.example`.

## 8. Success Metrics

- Bluesky/AT Proto code and dependencies are fully removed; the
  bundle no longer contains the AT Proto SDKs.
- A new user can sign up via magic link and complete an Autumn
  checkout in under 2 minutes.
- A paid user can save a drawing, publish it, share the
  `/post/:id` URL, and have the recipient load it without
  authentication.
- A canceled user retains access through the end of the paid period
  and loses paid features cleanly afterward.
- Account deletion removes all of a user's data and prevents further
  use of saved sessions.
- Free users can draw without seeing errors, and the upgrade path
  to `/pricing` is reachable from every gated control.

## 9. Open Questions

- **OQ-1:** What is the canonical image format and max size for a
  saved drawing? (PNG looks likely given the existing canvas, but
  decide before US-008.)
- **OQ-2:** When a subscription is `canceled` but still within the
  paid period, should `isPaid()` return `true` (let them keep using
  paid features until period end) or `false` (cut off immediately)?
  Default assumption in this PRD: `true` until period end. Confirm.
- **OQ-3:** Do we need any server-side abuse prevention on
  *publishing* (e.g. content moderation, flagging)? Out of scope for
  v1, but worth tracking.
- **OQ-4:** Do we want to pre-render `/post/:id` server-side for
  better link previews and SEO, or is client-side render with proper
  meta tags acceptable? (Affects how OG images work.)
- **OQ-5:** Email-change flow: do we require the new address to be
  unused, or do we allow swapping between two existing user
  accounts? (Current PRD assumes new address must be unused.)
- **OQ-6:** Do we need a "contact us" / support email surfaced
  somewhere given we are taking payment? (There is currently a
  `contact` route — confirm whether it stays.)
