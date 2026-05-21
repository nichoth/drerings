# Phase 1 Data Model: Restore atproto Sign-In

**Date**: 2026-05-20
**Plan**: [plan.md](./plan.md)

## Overview

This is a routing fix. **No persistent data model changes.**
There are no new database tables, columns, indexes, or migrations.
The schema artifacts that surround this fix (atproto OAuth state /
session stores, share events, stamp lots, stamp transactions,
postcards, rate-limit buckets) all stay exactly as documented in
the project `CLAUDE.md`.

The "model" affected by this fix is the **routing artifact set** —
how URLs map to Netlify Function entrypoints. That is captured
below for plan completeness.

## Entity: Public API Endpoint

A public API endpoint is the tuple
`{ public_url, function_name, source_file }`.

### Fields

- `public_url`: The URL the SPA and external callers use
  (`/api/auth/login`, `/.well-known/oauth-client-metadata.json`).
  Stable across the fix. **Source of truth: `src/state.ts`,
  `src/routes/login.ts`, atproto client metadata document.**
- `function_name`: The Netlify Function name registered by file
  discovery (`auth-login`, `oauth-client-metadata`, `whoami`).
  Changes for the 14 affected handlers in this fix.
- `source_file`: The TypeScript file Netlify discovers as the
  entrypoint. Must satisfy
  `netlify/functions/<function_name>.ts`.

### Validation rules

- `function_name` MUST match `source_file` basename without
  extension.
- For every `[[redirects]]` block in `netlify.toml` with
  `to = "/.netlify/functions/<name>"`, a file
  `netlify/functions/<name>.ts` MUST exist.
- For every file in `netlify/functions/` whose basename matches
  `<dashed-name>.ts`, a `[[redirects]]` block in `netlify.toml`
  with `to = "/.netlify/functions/<dashed-name>"` MUST exist,
  unless the function is invoked only as a scheduled job
  (`refund-expired-gifts`, `verify-stamp-invariants`).
- No file under `netlify/functions/` may live more than one
  directory deep after this fix.

### Pre-fix vs. post-fix mapping

The following 14 endpoints change `function_name` and
`source_file`. `public_url` is invariant.

| public_url | pre-fix source_file | post-fix function_name + source_file |
| --- | --- | --- |
| `/api/auth/login` | `auth/login.ts` | `auth-login` (`auth-login.ts`) |
| `/api/auth/callback` | `auth/callback.ts` | `auth-callback` (`auth-callback.ts`) |
| `/api/auth/logout` | `auth/logout.ts` | `auth-logout` (`auth-logout.ts`) |
| `/api/billing/checkout` | `billing/checkout.ts` | `billing-checkout` (`billing-checkout.ts`) |
| `/api/billing/webhook` | `billing/webhook.ts` | `billing-webhook` (`billing-webhook.ts`) |
| `/api/postcards/send` | `postcards/send.ts` | `postcards-send` (`postcards-send.ts`) |
| `/api/shares/precheck` | `shares/precheck.ts` | `shares-precheck` (`shares-precheck.ts`) |
| `/api/shares/confirm` | `shares/confirm.ts` | `shares-confirm` (`shares-confirm.ts`) |
| `/api/stamps/lots` | `stamps/lots.ts` | `stamps-lots` (`stamps-lots.ts`) |
| `/api/stamps/refund` | `stamps/refund.ts` | `stamps-refund` (`stamps-refund.ts`) |
| `/api/stamps/transactions` | `stamps/transactions.ts` | `stamps-transactions` (`stamps-transactions.ts`) |
| `/api/stamps/gifts/checkout` | `stamps/gifts/checkout.ts` | `stamps-gifts-checkout` (`stamps-gifts-checkout.ts`) |
| `/api/stamps/gifts/refund` | `stamps/gifts/refund.ts` | `stamps-gifts-refund` (`stamps-gifts-refund.ts`) |
| `/api/webhooks/resend` | `webhooks/resend.ts` | `webhooks-resend` (`webhooks-resend.ts`) |

Endpoints unaffected (already flat, kept as-is):
`/api/whoami` (`whoami.ts`), `/api/account` (`account.ts`),
`/api/drawings` (`drawings.ts`), `/api/posts` (`posts.ts`),
`/.well-known/oauth-client-metadata.json`
(`oauth-client-metadata.ts`). Scheduled jobs unaffected:
`refund-expired-gifts.ts`, `verify-stamp-invariants.ts`.

## Entity: Redirect Rule (netlify.toml)

### Fields

- `from`: Public URL pattern (`/api/auth/login`).
- `to`: `/.netlify/functions/<function_name>`.
- `status`: 200 (rewrite, not 301/302). Honors the existing
  same-origin SPA contract.

### Invariants

- The redirect table in `netlify.toml` is the canonical public
  API surface.
- There is no `from = "/api/*"` catch-all after this fix. A
  request to `/api/<unknown>` resolves to the SPA fallback
  (`/* → /index.html status = 200`), which is the same UX a
  user would get from any unknown URL. (No new behavior — the
  prior catch-all routed `/api/<unknown>` to a Netlify 404 page,
  not a useful response either.)
- The `/.well-known/oauth-client-metadata.json` rewrite is
  unchanged.

## State transitions

None. Routing is stateless. Every request is independently
resolved through `netlify.toml` + the function index. The
`atproto_oauth_states`, `atproto_sessions`, `share_events`,
`stamp_lots`, `stamp_transactions`, `postcards`, and
`rate_limit_buckets` tables continue to govern their respective
flows unchanged.

## Relationships to existing domain model

- `auth-login` writes to `atproto_oauth_states` (via
  `getOAuthClient().authorize(handle)`).
- `auth-callback` reads `atproto_oauth_states`, writes
  `atproto_sessions` and `users` (via `upsertOAuthUser`), issues
  the `drerings_auth` cookie.
- `auth-logout` reads the cookie, calls
  `getOAuthClient().revoke(did)`, clears the cookie.
- `shares-precheck` and `shares-confirm` write `share_events`,
  and `shares-confirm` may debit `stamp_transactions` via
  `recordShare → debitStamp`.
- `postcards-send` writes `postcards`, transitions through the
  documented CAS state machine, and debits `stamp_transactions`.
- `billing-checkout` and `stamps-gifts-checkout` write
  `autumn_refund_attempts` on the failure path and credit
  `stamp_lots` on the Autumn webhook reply.
- `billing-webhook` services Autumn webhooks
  (`hasStampCheckout`, `creditStampLot`,
  `applyStampCheckout`).
- `webhooks-resend` services Resend bounce webhooks
  (`refundPostcardBounce`).
- `stamps-lots`, `stamps-refund`, `stamps-transactions`,
  `stamps-gifts-refund` read or mutate `stamp_lots` /
  `stamp_transactions` per documented invariants.

All of these flows continue to use the same `netlify/lib/` domain
modules with the same function signatures.

## Acceptance gates derived from this model

- **AG-D1**: After fix, `ls netlify/functions/` shows no
  subdirectory beyond zero or one level deep. (Scheduled-job
  flat files are unchanged.)
- **AG-D2**: After fix, `grep "from = \"/api/" netlify.toml`
  yields exactly one line per public endpoint, plus one line
  for `/.well-known/oauth-client-metadata.json`. No `/api/*`
  wildcard remains.
- **AG-D3**: After fix, every `to = "/.netlify/functions/X"`
  in `netlify.toml` has a corresponding
  `netlify/functions/X.ts`.
- **AG-D4**: After fix, no file under `netlify/functions/`
  whose basename matches a `to =` redirect is missing from the
  redirect table (lint-style check via a one-off `find` + `grep`
  pair documented in `quickstart.md`).
