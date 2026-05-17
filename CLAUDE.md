# drerings Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-05-17

## Active Technologies
- TypeScript 5.8 (ES2022, ESM), Node >=20.19 + Preact 10, `@preact/signals` 2, `htm` (tagged-template (002-remove-subscription-text)
- N/A for this change (drawings persistence and stamps state are (002-remove-subscription-text)
- N/A (UI-only change; auth status comes from the existing (003-hide-account-link)
- TypeScript 5.8 (ES2022, ESM), Node >=20.19 + Preact 10, `@preact/signals` 2, `htm`, Resend HTTP API, Svix signature verification (004-stamps)

- TypeScript 5.8 (ES2022, ESM), Node >=20.19 + Preact 10, `@preact/signals` 2, `htm`, (001-settings-link-auth)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript 5.8 (ES2022, ESM), Node >=20.19: Follow standard conventions

## Recent Changes
- 004-stamps: Wired stamps to real send path. New endpoints POST /api/postcards/send and POST /api/webhooks/resend; new env var RESEND_WEBHOOK_SECRET; append-only stamp_transactions enforced at DB layer; durable drift via stamp_invariant_alerts; forensic log via autumn_refund_attempts.
- 003-hide-account-link: Added TypeScript 5.8 (ES2022, ESM), Node >=20.19 + Preact 10, `@preact/signals` 2, `htm`,
- 002-remove-subscription-text: Added TypeScript 5.8 (ES2022, ESM), Node >=20.19 + Preact 10, `@preact/signals` 2, `htm` (tagged-template

- 001-settings-link-auth: Added TypeScript 5.8 (ES2022, ESM), Node >=20.19 + Preact 10, `@preact/signals` 2, `htm`,

<!-- MANUAL ADDITIONS START -->

## Postcards & Stamps (added 2026-05-17)

Operator docs live in `README.md` ("Resend Webhook", "Stamp invariant
alerts", "Reconciling failed Autumn refunds"). Skim those before
touching the stamp accounting code.

### Endpoints
- `POST /api/postcards/send` (`netlify/functions/postcards/send.ts`):
  authenticated. Debits one stamp, sends postcard via Resend, refunds
  on synchronous failure. Client helper is `State.SendPostcard` in
  `src/state.ts` (returns the `PostcardSendResult` discriminated
  union).
- `POST /api/webhooks/resend` (`netlify/functions/webhooks/resend.ts`):
  Svix-signed bounce handler. Refunds the stamp on hard bounces;
  no-ops on transient bounces.

### Required env vars
- `RESEND_WEBHOOK_SECRET`: Svix signing secret for the Resend bounce
  webhook. Missing → `verifyResendSignature` throws.
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (existing) are also required
  for postcard delivery.

### Refund contracts (`netlify/lib/billing.ts`)
`issueAutumnStampRefund` throws one of three new error classes that
callers and operators must handle distinctly:
- `InFlightRefundAttemptError` — another refund attempt is in flight.
- `OrphanedRefundAttemptError` — a prior attempt left no
  `stamp_transactions` row but may have moved money at Autumn.
- `AmbiguousRefundAttemptError` — local state is inconsistent and
  needs manual reconciliation.
See README "Reconciling failed Autumn refunds" for the operator
runbook.

### Invariants
- `stamp_transactions` is append-only at the DB layer (BEFORE
  UPDATE/DELETE triggers from migration 0007). Do not try to UPDATE
  or DELETE rows from app code — it will raise.
- `verifyStampInvariants` persists drift to `stamp_invariant_alerts`
  (migration 0008). Treat that table as the tripwire for accounting
  bugs; new alerts mean an invariant broke in production.
- Every Autumn refund attempt is forensically logged to
  `autumn_refund_attempts` (migration 0009) before the HTTP call. Use
  it to diagnose orphans.

<!-- MANUAL ADDITIONS END -->
