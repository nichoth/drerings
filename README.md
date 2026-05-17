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
`PACK_DEFINITIONS` in `netlify/lib/billing.ts`.

- `stamps_starter`: 10 stamps for $5.00. Metadata:
  `stamp_count=10`, `per_stamp_price_cents=50`.
- `stamps_bundle`: 25 stamps for $10.00. Metadata:
  `stamp_count=25`, `per_stamp_price_cents=40`.
- `stamps_big_bundle`: 60 stamps for $20.00. Metadata:
  `stamp_count=60`, `per_stamp_price_cents=33.33`.

After configuring the products, verify staging checkout by starting a
checkout for each pack and confirming Autumn sends a signed webhook to:

```txt
https://<your-staging-site>/api/billing/webhook
```

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

------------------------------------------------------



```
/ed3d-plan-and-execute:execute-implementation-plan docs/implementation-plans/2026-05-16-stamps/ .
```
