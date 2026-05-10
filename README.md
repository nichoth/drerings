# Drerings

Drawings for friends.

<details><summary><h2>Contents</h2></summary>

<!-- toc -->

- [Develop](#develop)
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
