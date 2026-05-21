# Routing Contract: `/api/*` → Netlify Functions

**Date**: 2026-05-21
**Spec**: [../spec.md](../spec.md)
**Plan**: [../plan.md](../plan.md)

This document is the authoritative mapping of public URL paths to
function files for this branch. It must agree with both
`netlify.toml`'s `[[redirects]]` table AND the actual files in
`netlify/functions/`. The new static-analysis test
(`test/netlify-toml-routing.test.ts`) enforces that agreement on
every `npm test` run.

## Source of truth

`netlify.toml` is the source of truth. This document is a
human-readable mirror; the test is the machine-readable enforcement.
If they disagree, `netlify.toml` wins, this doc is updated, and the
test catches the gap.

## Request-routed endpoints

Every entry below MUST be reachable in BOTH local development (via
`netlify dev`, launched by `npm start`) AND deployed environments
(staging, production) with no environment-specific divergence in the
routing layer.

| Public URL                                  | Function file                          | Method(s) | Notes |
| ------------------------------------------- | -------------------------------------- | --------- | ----- |
| `GET /api/auth/login`                       | `auth-login.ts`                        | GET       | 405 on other methods; 400 if `handle` missing; 429 if rate-limited; 302 to PDS otherwise |
| `GET /api/auth/callback`                    | `auth-callback.ts`                     | GET       | OAuth callback; sets `drerings_auth` cookie |
| `POST /api/auth/logout`                     | `auth-logout.ts`                       | POST      | Clears cookie + revokes atproto session |
| `GET /api/whoami`                           | `whoami.ts`                            | GET       | Returns `{ id, did, handle, stamps_balance }` |
| `* /api/account`                            | `account.ts`                           | GET/PATCH/DELETE | Account details + deletion |
| `POST /api/postcards/send`                  | `postcards-send.ts`                    | POST      | CAS-protected debit + send |
| `POST /api/shares/precheck`                 | `shares-precheck.ts`                   | POST      | Read-only share eligibility |
| `POST /api/shares/confirm`                  | `shares-confirm.ts`                    | POST      | Debits stamp if paid path |
| `POST /api/billing/checkout`                | `billing-checkout.ts`                  | POST      | Autumn checkout session |
| `POST /api/billing/webhook`                 | `billing-webhook.ts`                   | POST      | Autumn webhook receiver |
| `GET /api/stamps/lots`                      | `stamps-lots.ts`                       | GET       | Lists user's stamp lots |
| `GET /api/stamps/transactions`              | `stamps-transactions.ts`               | GET       | Lists user's stamp ledger |
| `POST /api/stamps/refund/:id`               | `stamps-refund.ts`                     | POST      | Splat — see "splats" below |
| `POST /api/stamps/gifts/checkout`           | `stamps-gifts-checkout.ts`             | POST      | Gift purchase checkout |
| `POST /api/stamps/gifts/refund/:id`         | `stamps-gifts-refund.ts`               | POST      | Splat |
| `POST /api/webhooks/resend`                 | `webhooks-resend.ts`                   | POST      | Svix-signed Resend webhook |
| `* /api/drawings` and `/api/drawings/*`     | `drawings.ts`                          | GET/POST/DELETE | Splat |
| `* /api/posts` and `/api/posts/*`           | `posts.ts`                             | GET/POST/DELETE | Splat |
| `GET /.well-known/oauth-client-metadata.json` | `oauth-client-metadata.ts`           | GET       | Cacheable (the only `json()` opt-out) |

### Splat handling

For redirects whose `from` ends in `/*`, the matching `to` entry uses
`/:splat` to substitute the captured suffix. Example:

```toml
[[redirects]]
  from = "/api/stamps/refund/*"
  to   = "/.netlify/functions/stamps-refund/:splat"
  status = 200
```

This sends `POST /api/stamps/refund/abc123` to the
`stamps-refund.ts` function with `event.path` set such that the
handler can extract `abc123` from the URL path. The handler
implementations already do this — no change in scope.

## Non-routed function files (exclusion list)

These files exist in `netlify/functions/` but are NOT referenced by
any `[[redirects]]` entry. The static-analysis test allows them
explicitly:

| File                          | Why no redirect |
| ----------------------------- | --------------- |
| `refund-expired-gifts.ts`     | Scheduled job (run via Netlify Scheduled Functions, not HTTP) |
| `verify-stamp-invariants.ts`  | Scheduled job |

`webhooks-resend.ts`, `billing-webhook.ts`, and
`oauth-client-metadata.ts` ARE routed (see table above) — they
appear here for completeness of the "is it routed?" question only.

## Routing pipeline

### Production (and staging)

```text
Browser → Netlify edge → netlify.toml [[redirects]] →
  /.netlify/functions/<name> → ESM bundle of <name>.ts → Handler
```

### Local development (after this fix)

```text
Browser → netlify dev (port 8888) → netlify.toml [[redirects]] →
  internal functions server → esbuild compile <name>.ts → Handler
```

The two pipelines share the redirect table. There is no parallel
config in `vite.config.js`; the Vite proxy block is removed.

### Local development with bare Vite (UNSUPPORTED)

`npx vite` alone serves only static assets. `/api/*` will 404 at the
Vite layer (no proxy is configured after this fix). This is an
explicit non-support contract: contributors who want to test
`/api/*` MUST run `npm start` (which runs `netlify dev`). The README
states this requirement.

## Allowed handler responses

Per spec FR-006, this fix preserves every existing handler behavior.
Routing-layer reachability is the contract this document covers; the
handler itself may then return any of:

- `200` (success body)
- `302` (login → PDS authorize URL)
- `400` (missing/invalid body or query)
- `401` (no session)
- `403` (forbidden)
- `404` (record not found, from the application — distinct from the
  platform "Function not found" 404 the spec prohibits)
- `405` (wrong method)
- `409` (idempotency conflict)
- `429` (rate-limited)
- `500` (handler error)

A `404` body from the application layer (e.g. `drawings.ts`
returning JSON `{ error: 'not_found' }` for a missing drawing) is
valid. A platform-layer `404` ("Function not found") is the failure
the spec defines and this fix eliminates.

## Test enforcement

`test/netlify-toml-routing.test.ts` asserts:

1. Every `[[redirects]]` `to` of the form
   `/.netlify/functions/<name>` (with optional `/:splat`) maps to a
   file `netlify/functions/<name>.ts` that exists.
2. Every file in `netlify/functions/*.ts` EXCEPT the entries in the
   exclusion list above is referenced by at least one
   `[[redirects]]` entry.

The test parses `netlify.toml` with a minimal regex (the redirects
section is hand-edited and uniform; no full TOML parser dependency
is introduced) and uses Node's `fs.existsSync` / `fs.readdirSync`
for the file checks.
