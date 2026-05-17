# Stamps Remediation — Test Requirements

**Plan:** docs/implementation-plans/2026-05-16-stamps/phase_0{1..4}.md
**Generated:** 2026-05-16

This document maps every Acceptance Criterion (AC) defined in the four
phase files to the test(s) that will verify it. Phase plans deliberately
do not include test code — only what tests must verify. This file honors
that boundary.

Test naming convention follows the plan: new tests live in
`test/us0NN-*.test.ts` where the `0NN` will be assigned at
implementation time. The `Status` column marks each test as:
- **NEW** — added by this remediation plan.
- **EXTEND** — modifies an existing test file (the file already exists;
  this plan adds or changes assertions).
- **EXISTING** — already in the tree; re-asserted by this plan only as
  a regression check; no edits required.

Test types:
- **unit** — pure function or module under test in isolation, no DB,
  no network. Often vitest with `vi.fn()` for collaborators.
- **integration (mocked DB)** — exercises the function end-to-end with
  `vi.doMock('@netlify/database', …)` to swap the pg pool for a stub.
  Same pattern as `test/us004-refund-failed-send.test.ts:13–33`.
- **integration-with-real-db** — connects to the local Netlify-managed
  Postgres after `npx netlify db migrations apply`. Gated by
  `RUN_DB_INTEGRATION=1` so default `npm run test:e2e` still passes on
  machines without a DB.
- **component** — Preact component rendered into JSDOM; asserts on the
  rendered DOM and on signal state.
- **e2e** — full app exercised in a real browser. None proposed; the
  plan keeps automated coverage at the integration tier and uses human
  verification for browser/email-only behavior.

---

## Coverage matrix

| AC | Description (one line) | Test file | Type | Status |
|----|------------------------|-----------|------|--------|
| stamps.AC1.1 | Postcard send debits exactly one stamp on success (200, decremented balance, lot, append-only `send` tx row) | test/us0NN-postcard-send-api.test.ts | integration (mocked DB) | NEW |
| stamps.AC1.2 | Idempotent retry + stale-row resurrection: same `(idempotency_key)` returns same id; >10min queued rows are adopted | test/us0NN-postcard-send-api.test.ts | integration (mocked DB) | NEW |
| stamps.AC2.1 | `stamps_balance = 0` POST returns `402 insufficient_stamps`; no tx row, no email, no blob | test/us0NN-postcard-send-api.test.ts | integration (mocked DB) | NEW |
| stamps.AC2.2 (handler view) | Handler always returns 402 when `debitStamp` throws `InsufficientStampsError` regardless of which check tripped | test/us0NN-postcard-send-api.test.ts | integration (mocked DB) | NEW |
| stamps.AC2.2 (DB race) | Two simultaneous `debitStamp` calls on balance=1 produce exactly one success, no negative balance (`FOR UPDATE SKIP LOCKED`) | test/us003-debit-stamp.test.ts | integration-with-real-db | EXISTING — already covered by `test/us003-debit-stamp.test.ts`. Cannot be unit-tested with mocks; `RUN_DB_INTEGRATION=1` exercises the real lock. |
| stamps.AC2.3 | Free user (`subscription_status='free'`) with stamps gets 200, not 402; `isPaid` is not imported into the new handler | test/us0NN-postcard-send-api.test.ts | integration (mocked DB) + static grep assertion | NEW |
| stamps.AC3.1 | Blob write throw → 502, lot+balance restored, `failed_send_refund` tx row appended | test/us0NN-postcard-send-api.test.ts | integration (mocked DB) | NEW |
| stamps.AC3.2 | Resend non-2xx → 502 + same refund path | test/us0NN-postcard-send-api.test.ts | integration (mocked DB) | NEW |
| stamps.AC3.3 | Refund preserves audit trail: original `send` row not updated/deleted; `failed_send_refund` is a new row | test/us0NN-postcard-send-api.test.ts | integration (mocked DB) | NEW |
| stamps.AC4.1 (Bluesky path) | `POST /api/posts` continues to publish without calling `debitStamp` | test/us024-bluesky-free-posting.test.ts | integration (mocked DB) | EXISTING |
| stamps.AC4.1 (UI label moved) | Misleading "1 stamp" label is gone from the Publish button group | test/us013-send-stamp-indicator.test.ts | component | EXTEND — existing assertion is rescoped to the postcard group; a sibling assertion asserts the Publish group does NOT contain "1 stamp". |
| stamps.AC5.1 | `SendRoute` renders recipient email input + "Send postcard" button; success replaces form with success panel showing recipient + balance + "Send another" | test/us0NN-postcard-send-route.test.ts | component | NEW |
| stamps.AC5.2 | 402 from `State.SendPostcard` opens `BuyPackModal` (open-signal flips to true) | test/us0NN-postcard-send-route.test.ts | component | NEW |
| stamps.AC5.3 | 502 from `State.SendPostcard` shows inline message in `role="alert"` containing "your stamp has been refunded" | test/us0NN-postcard-send-route.test.ts | component | NEW |
| stamps.AC5.4 | "1 stamp" indicator appears next to "Send postcard" only, not next to Publish | test/us0NN-postcard-send-route.test.ts + test/us013-send-stamp-indicator.test.ts | component | NEW (positive case) + EXTEND (negative case on Publish) |
| stamps.AC6.1 | Hard bounce on a `sent` postcard refunds: `refundFailedSend` + `markFailedRefunded` called, 200 `{refunded:true}` | test/us0NN-resend-bounce-handler.test.ts | integration (mocked DB) | NEW |
| stamps.AC6.2 | Transient bounce (`soft_bounce` etc.) → 200 `{refunded:false, reason:'transient'}`; no refund | test/us0NN-resend-bounce-handler.test.ts | integration (mocked DB) | NEW |
| stamps.AC6.3 | Unknown `email_id` → 200 `{refunded:false, reason:'not_a_postcard'}`; no writes | test/us0NN-resend-bounce-handler.test.ts | integration (mocked DB) | NEW |
| stamps.AC6.4 | Postcard already `failed_refunded` → 200 `{refunded:false, reason:'already_refunded'}`; no second refund | test/us0NN-resend-bounce-handler.test.ts | integration (mocked DB) | NEW |
| stamps.AC6.5 | Non-bounce events (`email.delivered`, etc.) → 200 `{received:true}`; no DB query | test/us0NN-resend-bounce-handler.test.ts | integration (mocked DB) | NEW |
| stamps.AC7.1 | Missing svix headers → 400 `invalid_signature`; no DB, no refund | test/us0NN-resend-webhook-handler.test.ts + test/us0NN-resend-bounce-handler.test.ts | integration (mocked DB) | NEW |
| stamps.AC7.2 | Bad signature → 400 `invalid_signature` | test/us0NN-resend-webhook-handler.test.ts + test/us0NN-resend-bounce-handler.test.ts | integration (mocked DB) | NEW |
| stamps.AC7.3 | Stale timestamp (>5 min) → 400 `invalid_signature` | test/us0NN-resend-webhook-handler.test.ts + test/us0NN-resend-bounce-handler.test.ts | integration (mocked DB) | NEW |
| stamps.AC7.4 | GET/PUT/DELETE → 405 `method_not_allowed`; no signature check | test/us0NN-resend-webhook-handler.test.ts | integration (mocked DB) | NEW |
| stamps.AC8.1 | Bounce refund inserts new `failed_send_refund` row; original `send` row untouched | test/us0NN-resend-bounce-handler.test.ts | integration (mocked DB) | NEW |
| stamps.AC8.2 | New refund tx's `reference_id` matches the original send's `reference_id` (the postcard id) | test/us0NN-resend-bounce-handler.test.ts | integration (mocked DB) | NEW |
| stamps.AC9.1 | `UPDATE stamp_transactions` raises Postgres error containing `append-only`; row unchanged | test/us0NN-stamp-transactions-append-only.test.ts | integration-with-real-db | NEW — gated by `RUN_DB_INTEGRATION=1`. Pure-mock cannot prove trigger behavior; unit half only verifies the expected error-message format. |
| stamps.AC9.2 | `DELETE FROM stamp_transactions` raises `append-only` error; row remains | test/us0NN-stamp-transactions-append-only.test.ts | integration-with-real-db | NEW (gated) |
| stamps.AC9.3 | INSERT still works; all existing tests that insert into `stamp_transactions` still pass | test/us0NN-stamp-transactions-append-only.test.ts + full suite | integration-with-real-db + regression sweep | NEW (gated) + EXISTING (regression: us002, us003, us004, us006, us010, us012, us014, us015, us017, us018, us020, us021, us023, us025) |
| stamps.AC9.4 | TRUNCATE not blocked (documented behavior; test fixtures rely on it) | test/us0NN-stamp-transactions-append-only.test.ts | integration-with-real-db | NEW (gated) — single assertion that TRUNCATE succeeds against a row that UPDATE/DELETE would reject. Also covered by migration-comment review. |
| stamps.AC10.1 | Detected drift inserts row into `stamp_invariant_alerts` with `(user_id, invariant, expected, actual, detected_at, resolved_at=NULL)` | test/us0NN-stamp-invariant-alerts.test.ts | integration (mocked DB) | NEW |
| stamps.AC10.2 | One run produces at most one alert row per `(user_id, invariant)`; two drifts for one user yield two rows | test/us0NN-stamp-invariant-alerts.test.ts | integration (mocked DB) | NEW |
| stamps.AC10.3 | Re-detected drift across runs does NOT insert a second row while previous is open (`ON CONFLICT DO NOTHING` on partial unique index) | test/us0NN-stamp-invariant-alerts.test.ts | integration (mocked DB) | NEW (+ manual verification via `npx netlify db query` for the partial-index behavior on a live DB) |
| stamps.AC10.4 | Clean run inserts zero rows | test/us0NN-stamp-invariant-alerts.test.ts | integration (mocked DB) | NEW |
| stamps.AC10.5 | Manual resolution (`resolved_at = now()`) clears alert; re-detection inserts a new row | (schema-level property) verified via integration-with-real-db smoke script in phase_03 Task 3 + part of test/us0NN-stamp-transactions-append-only.test.ts companion fixtures | integration-with-real-db | NEW (gated) + HV-3 below as backup |
| stamps.AC11.1 | `verifyStampInvariants()` return shape `{usersChecked, driftCount, drifts}` unchanged | test/us025-stamp-invariants.test.ts + test/us0NN-stamp-invariant-alerts.test.ts | integration (mocked DB) | EXISTING (us025 — must continue to pass) + NEW (assertion in new test) |
| stamps.AC11.2 | Existing `console.error('Stamp invariant drift detected.', …)` still emitted once per drift | test/us0NN-stamp-invariant-alerts.test.ts | integration (mocked DB) | NEW (spy on console.error) |
| stamps.AC12.1 | 25/$10 fully-divisible refund: 15 remaining → 600c | test/us014-refund-calculation.test.ts | unit | EXISTING (re-asserted as baseline lock by new test) |
| stamps.AC12.2 | 60/$20 non-divisible: 60/59/30/7/1 remaining → 2000/1966/1000/233/33c | test/us0NN-refund-calculation-edge-cases.test.ts | unit | NEW |
| stamps.AC12.3 | Sum of refunds for a fully-debited lot never exceeds original price | test/us0NN-refund-calculation-edge-cases.test.ts | unit (property-style) | NEW |
| stamps.AC12.4 | Grant and `gift_received` lots return 0 regardless of `price_paid_cents` | test/us0NN-refund-calculation-edge-cases.test.ts | unit | NEW |
| stamps.AC13.1 | Sync blob failure path: 502 + `failed_send_refund` row appended (end-to-end, sequence of SQL calls asserted) | test/us0NN-failed-send-refund-e2e.test.ts | integration (mocked DB) | NEW |
| stamps.AC13.2 | Async hard-bounce path: webhook → `refundFailedSend` → `failed_send_refund` row appended | test/us0NN-failed-send-refund-e2e.test.ts | integration (mocked DB) | NEW |
| stamps.AC13.3 | Double-fault: sync refund already happened → async bounce returns `{refunded:false, reason:'already_refunded'}`, no second tx row | test/us0NN-failed-send-refund-e2e.test.ts | integration (mocked DB) | NEW |
| stamps.AC14.1 | Gift created 29d 23h 59m ago with `hasFullLot=true` is refundable | test/us0NN-gift-refund-boundary.test.ts | unit (fake timers) | NEW |
| stamps.AC14.2 | Gift created 30d 1s ago is NOT refundable (throws `StampLotNotRefundableError`) | test/us0NN-gift-refund-boundary.test.ts | unit (fake timers) | NEW |
| stamps.AC14.3 | Gift inside window but `hasFullLot=false` (recipient used 1 stamp) is NOT refundable | test/us0NN-gift-refund-boundary.test.ts | unit (fake timers) | NEW |
| stamps.AC15.1 | Attempt row inserted into `autumn_refund_attempts` with `status='attempted'` BEFORE the fetch | test/us0NN-autumn-refund-attempts.test.ts | integration (mocked DB) | NEW |
| stamps.AC15.2 | 2xx response → row transitions to `succeeded` with `http_status` + `response_body` + `responded_at` | test/us0NN-autumn-refund-attempts.test.ts | integration (mocked DB) | NEW |
| stamps.AC15.3 | Non-2xx → row transitions to `failed` with `http_status` + truncated body; function still throws | test/us0NN-autumn-refund-attempts.test.ts | integration (mocked DB) | NEW |
| stamps.AC15.4 | `fetch` throw → row transitions to `failed` with `http_status=NULL` + `error_message`; function rethrows | test/us0NN-autumn-refund-attempts.test.ts | integration (mocked DB) | NEW |
| stamps.AC15.5 (succeeded) | Prior `succeeded` row → no fetch, resolve void | test/us0NN-autumn-refund-attempts.test.ts | integration (mocked DB) | NEW |
| stamps.AC15.5 (attempted <60s) | Prior `attempted` <60s → throws `InFlightRefundAttemptError`, no fetch | test/us0NN-autumn-refund-attempts.test.ts | integration (mocked DB) | NEW |
| stamps.AC15.5 (attempted ≥60s) | Prior `attempted` ≥60s → throws `OrphanedRefundAttemptError`, no fetch | test/us0NN-autumn-refund-attempts.test.ts | integration (mocked DB) | NEW |
| stamps.AC15.5 (failed 4xx) | Prior `failed` 4xx → safe to retry; fetch called; row resets to `attempted` then transitions | test/us0NN-autumn-refund-attempts.test.ts | integration (mocked DB) | NEW |
| stamps.AC15.5 (failed 5xx) | Prior `failed` 5xx → throws `AmbiguousRefundAttemptError` containing `502`, no fetch | test/us0NN-autumn-refund-attempts.test.ts | integration (mocked DB) | NEW |
| stamps.AC15.5 (failed network) | Prior `failed` with `http_status=NULL` → throws `AmbiguousRefundAttemptError` mentioning network error, no fetch | test/us0NN-autumn-refund-attempts.test.ts | integration (mocked DB) | NEW |
| stamps.AC15.6 | Attempt row written via `db.pool.query` (not via `client` from `pool.connect()`); survives caller ROLLBACK | test/us0NN-autumn-refund-attempts.test.ts | integration (mocked DB) — structural check on mock's `connect` count | NEW (mock-based proof) + HV-4 below for real-DB confirmation |
| stamps.AC15.7 | `shouldUseMockCheckout()` true → early return; no `pool.query`, no `fetch` | test/us0NN-autumn-refund-attempts.test.ts | integration (mocked DB) | NEW |

**Row count: 51.**

---

## Regression-only existing tests (must remain green)

These existing tests are not the primary verification of any AC but
must continue to pass throughout this plan. They are the regression
safety net for the refactor / additive changes.

- `test/us003-debit-stamp.test.ts` — `debitStamp` signature + concurrency.
- `test/us004-refund-failed-send.test.ts` — `refundFailedSend` signature.
- `test/us014-billing-checkout-api.test.ts` — exercises
  `issueAutumnStampRefund` indirectly via `refundPurchasedStampLot`.
- `test/us015-billing-webhook-api.test.ts` — Autumn webhook behavior
  unchanged by Phase 2's Svix-helper refactor.
- `test/us015-stamp-refund-api.test.ts` — refund API end-to-end.
- `test/us024-bluesky-free-posting.test.ts` — Bluesky publish stays free
  (primary verification of stamps.AC4.1's API half).
- `test/us025-stamp-invariants.test.ts` — `verifyStampInvariants` return
  shape preserved (primary verification of stamps.AC11.1).
- Billing-webhook tests in general — the Svix-helper extraction in
  Phase 2 Task 1 must be transparent.

---

## Human verification items

Some ACs cannot be fully verified by automated tests. Mail delivery,
PNG rendering inside real mail clients, real-Postgres trigger behavior
on a deployed environment, and reconciliation against the live Autumn
dashboard are all things only a human can confirm.

### HV-1: PNG postcard renders in the recipient's inbox

- **Verifies:** real-world completion of stamps.AC1.1 (and the
  out-of-AC-but-design-critical email rendering behavior).
- **Why manual:** Resend's response only indicates the email was
  accepted by Resend, not by the destination MTA, and absolutely not
  that the PNG renders correctly across mail clients. No automated
  harness can sign in to Gmail/Apple Mail and visually verify the
  attachment.
- **Procedure:** Send a postcard from staging to a personal Gmail
  account AND a personal Apple Mail account. Open both. Confirm the
  PNG renders (inline or as an attachment) and the subject line
  reads "<displayName> sent you a Drering" with no raw sender email.

### HV-2: Resend hard-bounce path actually fires end-to-end

- **Verifies:** real-world completion of stamps.AC6.1 (the webhook
  arrives, signature passes, refund happens against a live DB).
- **Why manual:** the webhook delivery, the bounce classification by
  the destination MTA, and the Svix signature against the production
  secret all live outside test fabric.
- **Procedure:** Send a postcard from staging to a known-bad address
  (e.g., `nonexistent-${Date.now()}@gmail.com`). Wait ~60 seconds.
  Confirm via Resend's dashboard that `email.bounced` fired. Query
  `stamp_transactions` for a `failed_send_refund` row matching the
  postcard id, and confirm the postcard's `status` is
  `failed_refunded`. Confirm the user's `stamps_balance` returned to
  its pre-send value.

### HV-3: Operator can resolve a stamp invariant alert and re-detection works

- **Verifies:** real-world completion of stamps.AC10.5 against the
  Postgres partial unique index. The automated test asserts the
  schema-level property via mocked SQL; this confirms the live index
  behaves as expected against the deployed migration.
- **Why manual:** partial unique indexes interact subtly with replica
  identity and `ON CONFLICT` predicate matching; a live verification
  pass against production-equivalent Postgres is cheap insurance.
- **Procedure:** Run the smoke script from phase_03 Task 3
  (`npx netlify db query` sequence with a synthetic user) on a fresh
  local DB. Confirm: first INSERT succeeds, UPDATE-to-resolved
  succeeds, second INSERT (after resolution) succeeds, parallel
  unresolved INSERT raises a unique violation.

### HV-4: Autumn refund attempt row survives caller ROLLBACK

- **Verifies:** real-world completion of stamps.AC15.6. The automated
  test proves the function uses `db.pool.query` (not a transactional
  client) via mock structural inspection; this confirms the row
  actually survives a rollback in live Postgres.
- **Why manual:** demonstrating connection-pool isolation in a unit
  test is structural-only; the meaningful proof is that the row is
  durable across a real transaction boundary in real Postgres.
- **Procedure:** With a local DB plus a stub Autumn that returns 200,
  manually trigger `refundPurchasedStampLot` and force the local
  transaction to ROLLBACK (e.g., temporarily corrupt the
  `stamp_lots` UPDATE in the wrapping transaction). Confirm:
  `stamp_transactions` has no `refund` row (rollback worked), but
  `autumn_refund_attempts` has a `succeeded` row (forensic log
  survived). The scheduled invariant check should then flag the
  drift on its next run.

### HV-5: End-to-end browser smoke test of the whole stamps feature

- **Verifies:** integration of all four phases. No single AC; this is
  the final "did we ship a coherent product" check called out in
  phase_04 Task 6 and phase_01 Task 5.
- **Why manual:** stitching the UI, the API, Resend, the bounce
  webhook, Autumn checkout, and the scheduled invariant check
  together exceeds what mocked tests assert. The plan deliberately
  calls this out as a human gate.
- **Procedure:** With `npm start` running and a real (or
  Autumn-mock-mode) checkout configured:
  1. Sign in as a new user; observe the 5-stamp signup grant.
  2. Send a postcard to a personal email; confirm receipt (see HV-1).
  3. Send to a malformed address; confirm 502 + refund message.
  4. Buy a Starter pack via the buy modal.
  5. Refund the unused stamps on the Starter pack; confirm Autumn
     dashboard shows the refund and `autumn_refund_attempts` shows a
     `succeeded` row.
  6. Trigger the scheduled invariant function manually:
     `curl -X POST http://localhost:9999/.netlify/functions/verify-stamp-invariants`.
     Expected: `{driftCount: 0}` and no new rows in
     `stamp_invariant_alerts`.

### HV-6: Resend webhook setup in the dashboard

- **Verifies:** operational completion of Phase 2 Task 4 (not an AC,
  but a deployment prerequisite for stamps.AC6.* to function in
  production).
- **Why manual:** the Resend dashboard cannot be configured by code.
- **Procedure:** In the Resend dashboard, add the webhook endpoint
  `https://<host>/api/webhooks/resend`, subscribe to `email.bounced`,
  copy the `whsec_…` secret into `RESEND_WEBHOOK_SECRET` on Netlify.
  Use Resend's "Send a test" button — expect a 400
  `invalid_signature` from a synthetic payload (the test event is not
  Svix-signed with the production secret). Trigger a real bounce
  per HV-2 to confirm end-to-end.

**HV item count: 6.**
