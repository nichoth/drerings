# HTTP Contracts: Public API Endpoints (post-fix routing)

**Date**: 2026-05-20
**Plan**: [../plan.md](../plan.md)
**Spec**: [../spec.md](../spec.md)

## Scope of this contract document

This document is a routing contract, not a request/response
contract. The request and response shapes of each endpoint are
already documented in the project `CLAUDE.md` (see "atproto OAuth",
"Shares", "Postcards", "Pricing & stamp packs", "HTTP response
defaults" sections) and embodied in the handler files themselves.

The contract this fix establishes is:

> Every public URL listed below MUST reach its named handler. The
> handler's response (200, 302, 400, 401, 405, 429, etc.) is
> handler-defined and unchanged.

If a future change adds a new endpoint, that change MUST add a
matching `[[redirects]]` block AND a flat function file. The
routing contract has no wildcard fallback after this fix.

## Auth endpoints (the bug surface)

| Public URL | Method | Function name | Handler responsibility | Expected non-404 statuses |
| --- | --- | --- | --- | --- |
| `/api/auth/login` | GET | `auth-login` | Begin atproto OAuth, redirect to PDS authorize URL | 302, 400 (`handle_required`), 405 (non-GET), 429 (rate-limited) |
| `/api/auth/callback` | GET | `auth-callback` | Exchange code, upsert user, set `drerings_auth` cookie | 302, 400 (`invalid_callback`, `oauth_callback_failed`), 405 |
| `/api/auth/logout` | POST | `auth-logout` | Revoke atproto session, clear cookie | 200, 405 |
| `/.well-known/oauth-client-metadata.json` | GET | `oauth-client-metadata` | Serve cacheable client metadata document | 200 |

## Share endpoints

| Public URL | Method | Function name | Expected non-404 statuses |
| --- | --- | --- | --- |
| `/api/shares/precheck` | POST | `shares-precheck` | 200, 400, 401, 404 (drawing not owned), 405, 429 |
| `/api/shares/confirm` | POST | `shares-confirm` | 200, 400, 401, 404, 405, 409 (idempotency conflict), 429 |

## Postcard endpoints

| Public URL | Method | Function name | Expected non-404 statuses |
| --- | --- | --- | --- |
| `/api/postcards/send` | POST | `postcards-send` | 200, 400, 401, 405, 409 (`send_in_progress`), 429, plus stamp-debit failure responses per CAS state machine |

## Billing endpoints

| Public URL | Method | Function name | Expected non-404 statuses |
| --- | --- | --- | --- |
| `/api/billing/checkout` | POST | `billing-checkout` | 200, 400, 401, 405, 429 |
| `/api/billing/webhook` | POST | `billing-webhook` | 200 (idempotent), 400, 405 |

## Stamp endpoints

| Public URL | Method | Function name | Expected non-404 statuses |
| --- | --- | --- | --- |
| `/api/stamps/lots` | GET | `stamps-lots` | 200, 401, 405 |
| `/api/stamps/transactions` | GET | `stamps-transactions` | 200, 401, 405 |
| `/api/stamps/refund` (with path param `:lotId`) | POST | `stamps-refund` | 200, 400, 401, 404, 405 |
| `/api/stamps/gifts/checkout` | POST | `stamps-gifts-checkout` | 200, 400, 401, 405, 429 |
| `/api/stamps/gifts/refund` (with path param `:lotId`) | POST | `stamps-gifts-refund` | 200, 400, 401, 404, 405 |

> **Note on path-parametric endpoints.** `/api/stamps/refund/:lotId`
> and `/api/stamps/gifts/refund/:lotId` are written by the SPA as
> `/api/stamps/refund/${lotId}` and
> `/api/stamps/gifts/refund/${lotId}` respectively (see
> `src/state.ts:460` and `src/state.ts:507`). The `[[redirects]]`
> rule MUST be a splat (`from = "/api/stamps/refund/*" to =
> "/.netlify/functions/stamps-refund/:splat"`) or use Netlify's
> path-parameter syntax so the function receives the trailing
> segment as path. Pre-fix, the `/api/*` wildcard handled this
> implicitly by passing the splat tail down. Post-fix, the
> explicit rule MUST preserve it.

## Webhook endpoints

| Public URL | Method | Function name | Expected non-404 statuses |
| --- | --- | --- | --- |
| `/api/webhooks/resend` | POST | `webhooks-resend` | 200 (idempotent), 400 (invalid signature), 405 |

## Read-only / scheduled endpoints (unchanged by this fix)

| Public URL | Method | Function name |
| --- | --- | --- |
| `/api/whoami` | GET | `whoami` |
| `/api/account` | GET, DELETE | `account` |
| `/api/drawings` | GET, POST, etc. | `drawings` |
| `/api/posts` | GET, POST | `posts` |
| _(scheduled)_ refund-expired-gifts | — | `refund-expired-gifts` |
| _(scheduled)_ verify-stamp-invariants | — | `verify-stamp-invariants` |

## Contract invariants (assertable from the redirect table alone)

- **CI-1**: Every entry in this contract document corresponds to
  a `[[redirects]]` block in `netlify.toml` and a flat file in
  `netlify/functions/`.
- **CI-2**: No `[[redirects]]` block uses a wildcard `/api/*`.
- **CI-3**: The `/.well-known/oauth-client-metadata.json` redirect
  is preserved byte-for-byte with the pre-fix behavior, including
  its `Cache-Control` (served by the handler, not the redirect
  layer).
- **CI-4**: For path-parametric endpoints (`stamps-refund`,
  `stamps-gifts-refund`), the redirect rule passes the trailing
  path segment to the function so the handler can read it via the
  Netlify event's `path` / `rawUrl`.

## Behavioral non-changes (explicit guard-rails)

The following must remain identical pre- and post-fix:

- atproto OAuth scopes (`atproto transition:generic`).
- `drerings_auth` cookie format
  (`HttpOnly; Secure; SameSite=Lax; Max-Age=14d`, HMAC over
  base64url JSON payload).
- Per-IP rate limit on `auth-login`: 10/min.
- Per-user rate limits: `postcards-send` 30/min,
  `shares-confirm` 30/min, `billing-checkout` 5/min,
  `stamps-gifts-checkout` 5/min.
- `json()` default `Cache-Control: private, no-store` on all JSON
  API responses.
- Security headers (HSTS, X-Frame-Options DENY, Referrer-Policy,
  Permissions-Policy, CSP report-only) preserved byte-for-byte in
  `netlify.toml`.
- No CORS headers added.
- Postcard CAS state machine (`queued → debiting → sent |
  failed_refunded`), `refundPostcardBounce` atomicity, append-only
  invariants on `stamp_transactions` and `share_events` — all
  untouched.
