# Drerings

Drawings for friends.

<details><summary><h2>Contents</h2></summary>

<!-- toc -->

- [Develop](#develop)
- [OAuth Local Testing](#oauth-local-testing)
  * [Troubleshooting](#troubleshooting)
  * [Optional env vars](#optional-env-vars)

<!-- tocstop -->

</details>

## Develop

```sh
npm start
```

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

---
