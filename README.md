# drerings

Drawings for friends.

## develop

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

```text
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

- `BSKY_OAUTH_SCOPE`: override OAuth scope (default: `atproto repo:app.bsky.feed.post?action=create repo:app.bsky.actor.profile?action=create&action=update blob:*/* rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app#bsky_appview`)
- `BSKY_OAUTH_CLIENT_NAME`: client metadata `client_name`
- `BSKY_OAUTH_CLIENT_ORIGIN`: override client metadata origin (useful with ngrok/tunnel)

If Bluesky cannot reach your local client metadata URL, set `BSKY_OAUTH_CLIENT_ORIGIN`
to your HTTPS tunnel origin and retry.
