# Contract: Dev Routing Equivalence

**Branch**: `007-split-dev-ports`

This contract defines the observable URL-to-function mapping the
dev environment MUST provide. It is the dev-time analog of the
deployed `netlify.toml` `[[redirects]]` table, with the same
inputs and the same outputs.

## Surface

The SPA running in the browser on `http://127.0.0.1:8888` is
authoritative — it sees one origin. The contract is: for every
URL it can request, the response MUST be functionally identical
to what the production CDN would return for the same URL today.

## Required mappings

For each `(method, request URL)` pair below, the dev environment
MUST resolve to the listed Function and return that Function's
response unmodified (modulo body, headers the Function itself
sets, and the Functions runtime's own framing).

| Method | Request URL | Resolved Function |
|---|---|---|
| `GET`  | `/api/auth/login?handle=…` | `auth-login` |
| `GET`  | `/api/auth/callback?code=…&state=…` | `auth-callback` |
| `POST` | `/api/auth/logout` | `auth-logout` |
| `POST` | `/api/shares/precheck` | `shares-precheck` |
| `POST` | `/api/shares/confirm` | `shares-confirm` |
| `POST` | `/api/postcards/send` | `postcards-send` |
| `POST` | `/api/billing/checkout` | `billing-checkout` |
| `POST` | `/api/billing/webhook` | `billing-webhook` |
| `GET`  | `/api/stamps/lots` | `stamps-lots` |
| `GET`  | `/api/stamps/transactions` | `stamps-transactions` |
| `POST` | `/api/stamps/refund/<id>` | `stamps-refund` (path tail = `<id>`) |
| `POST` | `/api/stamps/gifts/checkout` | `stamps-gifts-checkout` |
| `POST` | `/api/stamps/gifts/refund/<id>` | `stamps-gifts-refund` (path tail = `<id>`) |
| `POST` | `/api/webhooks/resend` | `webhooks-resend` |
| `GET`  | `/api/whoami` | `whoami` (file: `whoami/whoami.ts`) |
| `*`    | `/api/drawings/…` | `drawings` (file: `drawings/drawings.ts`) |
| `*`    | `/api/posts/…` | `posts` (file: `posts/posts.ts`) |
| `*`    | `/api/account/…` | `account` (file: `account/account.ts`) |
| `GET`  | `/.well-known/oauth-client-metadata.json` | `oauth-client-metadata` |

This list is **the same** as the `[[redirects]]` table in
`netlify.toml`. Any divergence between the two is a defect. The
implementation MUST source from one place (the proxy map) and a
test or assertion MUST cover that every `netlify.toml` redirect
has a matching dev proxy entry.

## Behavioral guarantees

1. **Same-origin**: the browser observes every request and response
   as originating from `http://127.0.0.1:8888`. No `Access-Control-*`
   headers are needed or added. (SC-006, FR-012.)

2. **Cookie scope**: the `drerings_auth` cookie set by
   `auth-callback` is scoped to `127.0.0.1:8888` (the SPA origin)
   and is automatically included on subsequent same-origin
   requests like `/api/whoami`. (FR-005, AC1.3.)

3. **OAuth callback alignment**: the OAuth client metadata
   document returned by `GET /.well-known/oauth-client-metadata.json`
   contains a `redirect_uris` entry whose origin equals
   `http://127.0.0.1:8888`. (FR-004, AC1.2.)

4. **Strict port binding**: if either `8888` or `9999` is already
   in use, the start command fails loudly with a clear error
   identifying the conflicting port. It MUST NOT silently drift to
   a different port. (FR-010, edge-case bullet "second project
   binds 8888 or 9999".)

5. **HMR isolation**: editing a file under `src/` triggers Vite
   HMR. The Functions runtime is not restarted, and an in-progress
   `/api/*` call is unaffected. Editing a file under
   `netlify/functions/` triggers a function rebuild. The SPA is not
   reloaded, and HMR state in the browser is preserved. (FR-006,
   SC-004.)

6. **SPA history fallback in dev**: hitting `Refresh` on
   `/account`, `/login`, or any other client-side route returns
   the SPA shell, and the client router resolves the route.
   Internal Vite URLs (`/src/*`, `/@vite/*`, `/node_modules/*`,
   the HMR websocket) are NOT rewritten to `index.html`. (FR-007,
   FR-008, SC-003.)

## Out of scope

- The production redirect table in `netlify.toml`. This contract
  governs dev only. (FR-009, SC-005.)
- The shape of any function's request body or response body. Those
  are defined by their existing handlers and tests.
- Authentication semantics beyond cookie scoping. The atproto OAuth
  protocol contract with the PDS is unchanged.

## Verification

A request is "in contract" if and only if both of the following
are true:

- **Dev**: with `npm start` running, `curl -i
  http://127.0.0.1:8888/<URL>` returns the same status and
  Function-set headers it would return against a deployed
  preview environment for the same URL.
- **Prod**: the corresponding `netlify.toml` redirect still
  resolves the URL to the same function name unchanged from
  the pre-change baseline. (Mechanically: `git diff main --
  netlify.toml` shows only the removal of the `[dev]` block.)
