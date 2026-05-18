# Drerings

Drawings for friends.

<details><summary><h2>Contents</h2></summary>

<!-- toc -->

- [Develop](#develop)
- [Installability And Share Gate](#installability-and-share-gate)
- [Deployment](#deployment)
  * [Required Services](#required-services)
  * [Environment Variables](#environment-variables)
  * [Autumn Dashboard](#autumn-dashboard)
  * [Local Provider Behavior](#local-provider-behavior)
- [Test](#test)

<!-- tocstop -->

</details>

## Develop

```sh
npm start
```

## Installability And Share Gate

Drerings is installable as a PWA. The app manifest lives at
`public/manifest.webmanifest` and declares the standalone display mode,
theme colors, and the icon set used by install prompts.

Sharing is a paid feature. The frontend derives share eligibility from
`state.canShare`, which is true only when the current user's
`subscription_status` is `active`. Public-post share UI should use that
signal instead of duplicating subscription checks in route components.

The share flow uses the Web Share API when the browser supports it, then
falls back to copy-link and PNG download actions. See `docs/SMS.md` for the
underlying browser and SMS/Messages API rationale.

## Deployment

Deploy the app as a Netlify site with Functions, Netlify Database, and
Netlify Blobs enabled. The SPA talks to the backend through the `/api/*`
redirects that Netlify serves from `netlify/functions`.

### Required Services

- Netlify Database stores users, passkeys, magic-link tokens, saved
  drawings, and public post records. Apply the migrations in
  `netlify/database/migrations` before taking traffic.
- Netlify Blobs stores drawing PNGs in the `drawings` store. Blob keys use
  `users/<userId>/drawings/<drawingId>.png`.
- Resend sends magic-link login and email-change confirmation messages.
- Autumn handles checkout, cancellation, and subscription webhooks.

### Environment Variables

Set these values in the Netlify site environment for production:

- `RESEND_API_KEY`: Resend API key used by magic-link email delivery.
- `RESEND_FROM_EMAIL`: optional sender address. Defaults to
  `Drerings <login@drerings.app>`.
- `AUTUMN_SECRET_KEY`: Autumn API key, sent to Autumn as the bearer token.
- `AUTUMN_PRODUCT_ID`: Autumn product ID for the paid plan. Defaults to
  `paid` only in local/test paths.
- `AUTUMN_WEBHOOK_SECRET`: Svix signing secret from the Autumn webhook
  endpoint settings.
- `AUTUMN_API_URL`: optional Autumn API base URL override. Defaults to
  `https://api.useautumn.com`.
- `SESSION_SECRET`: long random string used to sign session cookies. Local
  Netlify development and tests fall back to `dev-session-secret`.

The app base URL is the deployed Netlify site URL. The current code derives it
from each request origin for login links, checkout success URLs, and checkout
cancel URLs. No `APP_BASE_URL` variable is read by the app today.

### Autumn Dashboard

Configure the paid product in Autumn with the product id from
`AUTUMN_PRODUCT_ID`. Checkout returns users to:

```txt
https://<your-netlify-site>/account?status=ok
```

The Stripe Checkout cancel URL is passed through Autumn as:

```txt
https://<your-netlify-site>/account?status=cancel
```

Create an Autumn webhook endpoint in the Autumn dashboard that points at:

```txt
https://<your-netlify-site>/api/billing/webhook
```

Copy that endpoint's Svix signing secret into `AUTUMN_WEBHOOK_SECRET`. The
Netlify Function validates `svix-id`, `svix-timestamp`, and `svix-signature`
before updating `users.subscription_status`.

### Resend Webhook (postcard bounces)

The `/api/webhooks/resend` endpoint expects an Svix-signed payload from
Resend. To enable it:

1. In the Resend dashboard, add a webhook endpoint with URL
   `https://<your-host>/api/webhooks/resend`.
2. Subscribe to the `email.bounced` event only. (Other events are
   silently no-op'd, but subscribing to fewer events reduces noise.)
3. Copy the signing secret (`whsec_…`) and set it as
   `RESEND_WEBHOOK_SECRET` in Netlify env.
4. The "Send a test" button in the Resend dashboard exercises the
   `400 invalid_signature` path with a synthetic payload — it's expected
   to NOT succeed in production until subscribed.

Configure these one-time stamp pack products in Autumn for prepaid
postcard sends. The product ids and metadata values must match
`PACK_DEFINITIONS` in `src/stamp-packs.ts`.

- `10_stamps`: 10 stamps for $5.00 (500 cents). Metadata:
  `stamp_count=10`, `per_stamp_price_cents=50`.
- `25_stamps`: 25 stamps for $10.00 (1000 cents). Metadata:
  `stamp_count=25`, `per_stamp_price_cents=40`.

After configuring the products, verify staging checkout by starting a
checkout for each pack and confirming Autumn sends a signed webhook to:

```txt
https://<your-staging-site>/api/billing/webhook
```

### Stamp invariant alerts

The scheduled function `verify-stamp-invariants` runs daily at 09:30 UTC
and writes any detected drift to the `stamp_invariant_alerts` table.

To see all active alerts:

```sql
SELECT
    id, user_id, invariant, expected, actual, detected_at
FROM stamp_invariant_alerts
WHERE resolved_at IS NULL
ORDER BY detected_at ASC;
```

Per docs/pricing.md, a human investigates the first drift before any
automated reconciliation runs. After investigating and fixing the
underlying cause, mark the alert resolved:

```sql
UPDATE stamp_invariant_alerts
SET resolved_at = now(), resolution_note = $1
WHERE id = $2;
```

If the same drift recurs on the next run, a new row is inserted — the
unique index excludes already-resolved alerts.

### Reconciling failed Autumn refunds

The refund code path throws one of four errors that need different operator
responses:

- **"Autumn refund failed."** — Autumn rejected the request, no money moved.
  Auto-retried on the next refund attempt for the same lot.
- **`InFlightRefundAttemptError`** — Another refund is in flight (started in
  the last 60 seconds). Wait and retry; no operator action needed.
- **`OrphanedRefundAttemptError`** — A previous attempt started >60s ago and
  never recorded an outcome (function timed out / crashed). Check Autumn's
  dashboard for the request — if it processed, mark the row succeeded
  manually (steps below); if not, mark it failed.
- **`AmbiguousRefundAttemptError`** — A previous attempt got a 5xx or
  network error. Autumn may or may not have processed it. Check Autumn's
  dashboard and reconcile.

For the last two: find the orphaned/ambiguous attempts:

```sql
SELECT id, checkout_id, amount_cents, http_status,
       response_body, error_message, attempted_at, responded_at
FROM autumn_refund_attempts
WHERE status = 'failed'
  AND attempted_at > now() - interval '30 days'
ORDER BY attempted_at DESC;
```

Cross-reference each failed attempt against the stamp_transactions
ledger:

```sql
SELECT * FROM stamp_transactions
WHERE reason = 'refund'
  AND reference_id = '<checkout_id from the attempt row>'
ORDER BY created_at DESC;
```

If a stamp_transactions row exists for that checkout_id, the local
state matches Autumn (good — the catch-and-rollback path worked). If
NO row exists but Autumn shows the refund in their dashboard, you
have an orphaned external refund; the local lot still shows stamps
as refundable and a customer could refund again. Manual steps:

1. INSERT the missing 'refund' stamp_transactions row.
2. UPDATE stamp_lots SET remaining_count = 0 for the affected lot.
3. UPDATE users SET stamps_balance to match.
4. UPDATE autumn_refund_attempts SET status = 'succeeded' for the
   attempt row.

The scheduled invariant check (Phase 3) will catch the drift on the
next run and write to stamp_invariant_alerts — that's your tripwire.

### Local Provider Behavior

Run the Netlify Functions and Vite dev server together:

```sh
npm start
```

Open the app at:

```txt
http://127.0.0.1:8888/login
```

When `NETLIFY_LOCAL=true` and `AUTUMN_SECRET_KEY` is unset, checkout uses a
mocked checkout URL and redirects back to `/account?status=ok`. This lets the
pricing and account UI run without a live Autumn account.

Resend is not mocked inside the Netlify Function. Magic-link delivery needs
`RESEND_API_KEY` for real local email. UI tests and browser smoke checks mock
auth endpoints when they need a signed-in user without sending email.

## Test

Run the focused Vitest file while developing a story:

```sh
npx vitest run test/us020-readme-deployment-notes.test.ts
```

Run lint and the full browser test bundle before committing:

```sh
npm run lint
npm test
```


----------------------------------------------------------------







