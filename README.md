# Drerings

Drawings for friends.

<details><summary><h2>Contents</h2></summary>

<!-- toc -->

- [Develop](#develop)
- [Autumn Billing](#autumn-billing)
- [OAuth Local Testing](#oauth-local-testing)
  * [Troubleshooting](#troubleshooting)
  * [Optional env vars](#optional-env-vars)

<!-- tocstop -->

</details>

## Develop

```sh
npm start
```

## Autumn Billing

`POST /api/billing/checkout` creates an Autumn checkout session for the
signed-in user. Local development can run without Autumn credentials; the
checkout endpoint returns a mocked `/account?status=ok` URL when
`NETLIFY_LOCAL=true` and no Autumn secret is configured.

Live checkout requires these Netlify environment variables:

* `AUTUMN_SECRET_KEY`: Autumn secret key, sent as the bearer token.
* `AUTUMN_PRODUCT_ID`: Autumn product ID for the paid plan. Defaults to
  `paid` for local testing.
* `AUTUMN_API_URL`: optional API base URL override. Defaults to
  `https://api.useautumn.com`.

The checkout success return URL is `/account?status=ok`. The Stripe Checkout
cancel URL is passed through Autumn as `/account?status=cancel`.

## OAuth Local Testing

Bluesky OAuth local callbacks should use `127.0.0.1` (not `localhost`).

1. Start the app with functions:

```sh
npm start
```

2. Open the app at:

```
http://127.0.0.1:8888/login
```

3. Start login from the `/login` page. The app now:
- Starts OAuth at `/api/auth/oauth/start`
- Uses PKCE (`code_verifier` + `S256` `code_challenge`)
- Uses OAuth server discovery + PAR (`request_uri`)
- Finishes callback exchange at `/api/auth/oauth/finish`

### Troubleshooting

- `Cannot GET /oauth/authorize` on a `*.host.bsky.network` URL:
  this means an old/non-discovered authorize endpoint is being used. The current
  flow should redirect to `https://bsky.social/oauth/authorize?...&request_uri=...`.
  Restart local dev server and retry from `http://127.0.0.1:8888/login`.

### Optional env vars

* `BSKY_OAUTH_SCOPE`: override OAuth scope (default: `atproto transition:generic`)
* `BSKY_OAUTH_CLIENT_NAME`: client metadata `client_name`
* `BSKY_OAUTH_CLIENT_ORIGIN`: override client metadata origin
  (useful with ngrok/tunnel)

If Bluesky cannot reach your local client metadata URL, set
`BSKY_OAUTH_CLIENT_ORIGIN` to your HTTPS tunnel origin and retry.

## Test

### Unit tests (faster)

```sh
npm test
```

### E2E tests

```sh
npm run test:e2e
```

### Test the block & report buttons

```sh
npm run test:e2e -- test/feed-route.actions.test.tsx
```

### the blocked-feed filtering test file

```sh
npm run test:e2e -- test/state.feed.test.ts
```

### test the color picker

```sh
npx vitest run test/home-route.color-picker.test.ts
```

---
