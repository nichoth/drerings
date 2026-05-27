# Flatten `/api/*` route paths

Date: 2026-05-27
Status: Approved for implementation planning

## Problem

`netlify.toml` and `vite.config.js` each carry a 15-entry routing
table that maps nested URL paths (`/api/auth/login`,
`/api/shares/precheck`, `/api/stamps/refund/:lot_id`, …) to the
corresponding Netlify Function file. Two tables that MUST stay in
sync — any new endpoint requires edits in both files (called out
explicitly in `CLAUDE.md` and `specs/007-split-dev-ports`). The
nested URL space is the only reason these tables are needed; the
function files themselves are already flat kebab-case
(`auth-login.ts`, `shares-precheck.ts`, …) so Netlify's default
`/api/* → /.netlify/functions/:splat` rule would handle them if
the URL space were also flat.

## Goal

Flatten every `/api/foo/bar*` URL to `/api/foo-bar*` so that:

1. `netlify.toml` keeps exactly **two** redirect rules — one
   `/api/*` splat and one for the RFC-fixed
   `/.well-known/oauth-client-metadata.json`.
2. `vite.config.js` keeps exactly **two** proxy entries with no
   per-route table — same shape as `netlify.toml`.
3. Adding a new endpoint is one step: create
   `netlify/functions/<kebab-name>.ts` and call
   `/api/<kebab-name>` from the client.

## URL mapping

```
OLD                              NEW
/api/auth/login              →   /api/auth-login
/api/auth/callback           →   /api/auth-callback
/api/auth/logout             →   /api/auth-logout
/api/shares/precheck         →   /api/shares-precheck
/api/shares/confirm          →   /api/shares-confirm
/api/postcards/send          →   /api/postcards-send
/api/billing/checkout        →   /api/billing-checkout
/api/billing/webhook         →   /api/billing-webhook
/api/stamps/lots             →   /api/stamps-lots
/api/stamps/transactions     →   /api/stamps-transactions
/api/stamps/refund/:lot_id   →   /api/stamps-refund/:lot_id
/api/stamps/gifts/checkout   →   /api/stamps-gifts-checkout
/api/stamps/gifts/refund/:id →   /api/stamps-gifts-refund/:id
/api/webhooks/resend         →   /api/webhooks-resend
```

Unchanged because they are already single-segment:
`/api/whoami`, `/api/account`, `/api/drawings`, `/api/drawings/:id`,
`/api/posts`, `/api/posts/:id`.

Unchanged because RFC-fixed:
`/.well-known/oauth-client-metadata.json`.

## Function-file changes

### No rename needed for the kebab-case functions

These 14 files keep their current names — the new URL is identical
to the file basename: `auth-login.ts`, `auth-callback.ts`,
`auth-logout.ts`, `billing-checkout.ts`, `billing-webhook.ts`,
`postcards-send.ts`, `shares-confirm.ts`, `shares-precheck.ts`,
`stamps-gifts-checkout.ts`, `stamps-gifts-refund.ts`,
`stamps-lots.ts`, `stamps-refund.ts`, `stamps-transactions.ts`,
`webhooks-resend.ts`.

### Flatten the four directory-style functions

Pure tidying for consistency — URLs don't change:

```
netlify/functions/whoami/whoami.ts       → netlify/functions/whoami.ts
netlify/functions/account/account.ts     → netlify/functions/account.ts
netlify/functions/drawings/drawings.ts   → netlify/functions/drawings.ts
netlify/functions/posts/posts.ts         → netlify/functions/posts.ts
```

Relative imports inside each file shift from `../../lib/…` to
`../lib/…`.

### Fix two path parsers

`stamps-refund.ts:57` (`lotIdFromPath`) looks for a literal
`'refund'` segment in `event.path`. After the rename the URL is
`/api/stamps-refund/:lot_id` — there is no `refund` segment.
Replace the lookup with: take the segment immediately after
`'stamps-refund'`.

`stamps-gifts-refund.ts:57` (`lotIdFromPath`) — same fix, anchor
on `'stamps-gifts-refund'`.

The other two parsers (`drawings/drawings.ts`'s
`drawingIdFromPath`, `posts/posts.ts`'s `postIdFromPath`) anchor
on `'drawings'` and `'posts'` respectively — those segments still
exist in the new URLs, so no change.

## Routing collapse

### `netlify.toml`

Replace lines 20–98 (the 15 `[[redirects]]` blocks) with:

```toml
[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200

[[redirects]]
  from = "/.well-known/oauth-client-metadata.json"
  to = "/.netlify/functions/oauth-client-metadata"
  status = 200
```

The SPA fallback redirects under `[context.production.redirects]`,
`[context.deploy-preview.redirects]`,
`[context.branch-deploy.redirects]` are unchanged. The `[functions]`
and `[build]` blocks are unchanged. The `[[headers]]` block is
unchanged.

### `vite.config.js`

Delete the `apiRewrites` array and the `rewriteApi` function.
Replace the `server.proxy` block with:

```js
proxy: {
    '/api': {
        target: 'http://127.0.0.1:9999',
        changeOrigin: false,
        rewrite: (path) => '/.netlify/functions' + path.slice(4),
    },
    '/.well-known/oauth-client-metadata.json': {
        target: 'http://127.0.0.1:9999',
        changeOrigin: false,
        rewrite: () => '/.netlify/functions/oauth-client-metadata',
    },
},
```

`path.slice(4)` strips the leading `/api` and keeps everything
after, including the leading slash, the path tail (for
`stamps-refund/:lot_id`), and any query string Vite passes through.

The header comment block at the top of `vite.config.js`
(lines 7–10) that warns about keeping `apiRewrites` in sync with
`netlify.toml` should be removed in the same change — the warning
is moot once the table is gone.

## Client call-sites that change

### `src/state.ts` (16 sites)

Mechanical kebab-case rewrites at lines 309, 326–327, 411, 460,
507, 550–551, 610, 634, 675, 710, 812, 933, 1081, 1129, 1175, 1210,
1230. The full list of replacements is the URL mapping table
above.

### `src/routes/login.ts` (1 site)

Line 19: `/api/auth/login?handle=…` → `/api/auth-login?handle=…`.

### `netlify/lib/auth/atproto.ts` (2 sites)

Lines 19 and 38: `${origin}/api/auth/callback` →
`${origin}/api/auth-callback`. The published
`oauth-client-metadata.json` derives its `redirect_uris` field from
this constant; PDSes refetch the metadata document on every login,
so changing the callback URL needs no re-registration.

### Tests that hit these URLs

Update in lockstep with the function/URL renames:

- `test/us010-delete-drawing-ui.test.ts` — references
  `/api/drawings/drawing-1` (unchanged URL, unaffected).
- `test/us012-public-post-api.test.ts` — synthetic `event.path`
  with `/api/posts/:id` (unchanged URL, unaffected).
- `test/us016-stamp-lots-api.test.ts` — synthetic `event.path`
  with `/api/stamps/lots`. Update to `/api/stamps-lots`.
- `test/us020-share-state.test.ts` — fetch-mock URL matchers for
  `/api/shares/precheck` and `/api/shares/confirm`. Update to
  `/api/shares-precheck` and `/api/shares-confirm`.
- `test/us031-postcard-send-route.test.ts` — fetch-mock matchers
  for `/api/drawings` (unchanged) and `/api/postcards/send`
  (update to `/api/postcards-send`).
- `test/us039-rate-limit-endpoints.test.ts` — `describe` titles
  for `/api/postcards/send`, `/api/shares/confirm`,
  `/api/billing/checkout`, `/api/stamps/gifts/checkout`. Update
  to the kebab equivalents.

The existing test suite (`npm test`) must remain green; that is
the primary verification gate.

### Operator docs

`README.md` mentions endpoint paths in three sections that need
updating in the same PR:

- atproto OAuth flow (lines ~128–143): URL list and worked example.
- Autumn webhook setup (line ~165, ~200): replace the example
  `/api/billing/webhook` URL.
- Resend webhook setup (lines ~174–178): replace the example
  `/api/webhooks/resend` URL.

`docs/SPEC.md`, `docs/pricing.md`, `docs/monetization.md`, and
`docs/audit-2026-05-18.md` are point-in-time documents describing
historical state — do NOT update them. They are not operator
references.

## Deploy choreography

Single PR, hard cutover. The risky bit is that the two webhook
URLs (`/api/webhooks-resend`, `/api/billing-webhook`) are
externally controlled and the dashboard config has to flip in
coordination with the deploy.

Recommended order:

1. Merge + deploy the PR. The old paths immediately 404; the new
   paths immediately work.
2. Within seconds: update the Resend dashboard webhook URL to
   `/api/webhooks-resend`.
3. Within seconds: update the Autumn dashboard webhook URL to
   `/api/billing-webhook`.

The gap is acceptable because:

- Resend retries bounce deliveries for ~48h (Svix policy) until a
  2xx is returned. Anything queued during the gap will deliver
  successfully after the dashboard is flipped.
- `refundPostcardBounce` is idempotent under retry (CAS-scoped
  `WHERE status IN ('sent','debiting')`), so even repeated
  deliveries of the same event are safe.
- Autumn retries checkout webhooks with exponential backoff.
  `applyStampCheckout` is idempotent via the migration 0015
  partial unique index on
  `stamp_lots(autumn_checkout_id) WHERE source IN ('purchase',
  'gift_received')`, so duplicate deliveries can't double-credit.

If the operator forgets to flip a dashboard URL, the worst case is
that webhook deliveries pile up in the provider's retry queue
until the dashboard is corrected — no data loss, no double-write.

## Verification

- `npm test` — full suite passes.
- `npm run lint` — passes.
- Manual smoke test via `npm start`:
  1. Open `http://127.0.0.1:8888`.
  2. Sign in with an atproto handle. Verify the OAuth redirect
     hits `/api/auth-callback` and the session cookie is set.
  3. Navigate to the dashboard, confirm `/api/whoami`,
     `/api/drawings`, `/api/stamps-lots`,
     `/api/stamps-transactions` all return 200.
  4. Open a drawing, try the share flow — verify
     `/api/shares-precheck` and (if paid) `/api/shares-confirm`.
  5. Confirm the OAuth client metadata document at
     `http://127.0.0.1:8888/.well-known/oauth-client-metadata.json`
     lists `http://127.0.0.1:8888/api/auth-callback` in
     `redirect_uris`.
- Production smoke after deploy:
  1. Hit `/api/auth-login?handle=<handle>` and complete a login.
  2. Trigger a test postcard send and a test share to confirm
     `/api/postcards-send` and `/api/shares-confirm` work end-to-end.
  3. Fire a Resend webhook test from the dashboard and verify
     it returns 200 from `/api/webhooks-resend`.
  4. Fire an Autumn webhook test from the dashboard and verify
     it returns 200 from `/api/billing-webhook`.

## Out of scope

- Renaming function file contents beyond the four directory→flat
  moves and the two path-parser fixes in
  `stamps-refund.ts` / `stamps-gifts-refund.ts`.
- Changing the SPA fallback redirects in `netlify.toml`.
- Touching any internal `netlify/lib/*` code (other than the two
  string constants in `auth/atproto.ts`).
- Updating historical specs under `specs/` or older docs in
  `docs/` that describe past behavior. Only `README.md` reflects
  current operator behavior.
- Any change to rate-limit keys. The keys are derived from the
  endpoint name (e.g. `postcards/send`), not the URL path; they
  live inside the handler files and stay as-is. (If a reviewer
  prefers, they can be updated to `postcards-send` etc. for
  cosmetic consistency in a separate change — but old buckets
  would then linger in `rate_limit_buckets` harmlessly until
  reaped.)

## Implementation phases

A single PR is appropriate. Suggested commit ordering inside the
PR:

1. Function-file moves (four directory→flat) + import path
   adjustments + two path-parser fixes. Tests still pass against
   the old URLs.
2. Update `netlify.toml` redirects and `vite.config.js` proxy.
   Update all client `fetch` sites, the OAuth callback constant,
   and every test that references an old URL. This is the atomic
   cutover commit — between commits 1 and 2 the dev server would
   404 on the renamed endpoints, so don't push 1 alone.
3. Update `README.md` operator sections.
