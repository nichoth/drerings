# Payment Hardening — Test Requirements

Maps every Acceptance Criterion (AC) across the seven phases to a concrete
test type, expected test file, and justification. Generated from the
`Acceptance Criteria Coverage` sections of each phase file.

- `unit` — fast, mocked, single-function focus
- `integration` — composes multiple modules (handlers + mocked DB or real
  PG fixtures)
- `e2e` — exercises a handler end-to-end with a real DB
- `human-verification` — cannot be automated reliably in this repo
  (browser policies, deploy-only headers, operational migrations,
  multi-process races against real Postgres)

Summary across 73 ACs / 7 phases:
- automated unit: 53
- automated integration: 7
- automated e2e: 1
- human-verification: 12

---

## Phase 1 — Gift recipient resolution

### payment-hardening.AC1.1 — `lookupGiftRecipient('alice.bsky.social')` returns matching `{id, handle, did}`

- Type: `unit`
- File: `test/us017-lookup-gift-recipient.test.ts`
- Notes: Mock `getDatabase().pool.query`; assert the handle SQL path
  (`WHERE lower(handle) = $1`) is called with normalized param and the
  returned row is propagated.

### payment-hardening.AC1.2 — `lookupGiftRecipient('did:plc:abc123')` returns the matching user row

- Type: `unit`
- File: `test/us017-lookup-gift-recipient.test.ts`
- Notes: Mock the DID SQL path (`WHERE did = $1`); verify case is
  preserved verbatim. Pure branch-coverage test.

### payment-hardening.AC1.3 — Case-insensitive handle lookup

- Type: `unit`
- File: `test/us017-lookup-gift-recipient.test.ts`
- Notes: Pass `'Alice.BSKY.Social'`; assert param is lowercased
  before the SQL call. Pure normalization assertion.

### payment-hardening.AC1.4 — Returns `null` for unknown handle/DID

- Type: `unit`
- File: `test/us017-lookup-gift-recipient.test.ts`
- Notes: Mock returns `{rows: []}`; trivial null-fallback assertion.

### payment-hardening.AC1.5 — Returns `null` for empty/whitespace input

- Type: `unit`
- File: `test/us017-lookup-gift-recipient.test.ts`
- Notes: Assert the DB mock is NOT called for `''` and `'   '` — the
  early-return guard is the only logic.

### payment-hardening.AC2.1 — Known recipient: 200 + `{url, recipient}` via `createGiftCheckoutSession`

- Type: `integration`
- File: `test/us017-gift-checkout-api.test.ts`
- Notes: Existing test file un-skipped. Composes handler + mocked
  resolver + mocked checkout session creator; asserts the right
  routing path.

### payment-hardening.AC2.2 — Email input: 200 via `createPendingGiftCheckoutSession`

- Type: `integration`
- File: `test/us017-gift-checkout-api.test.ts`
- Notes: Fallback branch with `someone@example.com`. Verifies the
  pending-recipient route is selected.

### payment-hardening.AC2.3 — Unknown handle: 404, never 500

- Type: `integration`
- File: `test/us017-gift-checkout-api.test.ts`
- Notes: Regression-prevention against the original bug — confirms the
  email-column query no longer raises 500.

### payment-hardening.AC2.4 — Self-gift: 404

- Type: `integration`
- File: `test/us017-gift-checkout-api.test.ts`
- Notes: Mock resolver returns `{id === session.user.id}`; preserve the
  existing 404 behavior at `checkout.ts:38`.

### payment-hardening.AC3.1 — Autumn metadata uses `gift_recipient_handle`, not email

- Type: `unit`
- File: `test/us017-gift-checkout-api.test.ts`
- Notes: Assert on the captured Autumn checkout body. Pure shape check
  on metadata fields.

### payment-hardening.AC3.2 — Pending recipient metadata uses `gift_pending_recipient_email`

- Type: `unit`
- File: `test/us017-gift-checkout-api.test.ts`
- Notes: Same captured-payload pattern as AC3.1, different branch.

### payment-hardening.AC4.1 — Webhook credits recipient + records sender txn

- Type: `unit`
- File: `test/us017-gift-stamp-webhook.test.ts`
- Notes: Un-skipped existing file. Mocks `creditGiftStampLot` and
  asserts `sendStampGiftEmail` is invoked with synthesized
  `${handle}@bsky.social`.

### payment-hardening.AC4.2 — Empty metadata falls back to direct purchase, no 5xx

- Type: `unit`
- File: `test/us017-gift-stamp-webhook.test.ts`
- Notes: Defensive shape check — webhook reader returns `undefined`
  for both gift extractors; handler treats as direct purchase.

### payment-hardening.AC5.1 — `test/us017-gift-checkout-api.test.ts` un-skipped + passing

- Type: `unit`
- File: `test/us017-gift-checkout-api.test.ts`
- Notes: Meta-AC — verified by the file itself running green (no
  `.skip`). Covered by `grep "describe.skip" test/us017-*` returning
  empty.

### payment-hardening.AC5.2 — `test/us017-gift-stamp-webhook.test.ts` un-skipped + passing

- Type: `unit`
- File: `test/us017-gift-stamp-webhook.test.ts`
- Notes: Same as AC5.1.

### payment-hardening.AC5.3 — `test/us017-gift-stamps-ui.test.ts` un-skipped + passing

- Type: `unit`
- File: `test/us017-gift-stamps-ui.test.ts`
- Notes: Same as AC5.1/AC5.2. Component-level — confirms fixture rename
  did not break UI behavior.

---

## Phase 2 — Idempotent Autumn webhook credit

### payment-hardening.AC6.1 — Partial UNIQUE index exists post-migration

- Type: `human-verification`
- File: Manual verification — `psql "$DATABASE_URL" -c "\d+ stamp_lots"
  | grep idx_stamp_lots_autumn_checkout_purchase`
- Notes: Migration applied operationally. Index presence in PG catalog
  is best verified by an operator running the migration in dev/staging
  and inspecting `pg_indexes`. Could be wrapped in a one-shot test
  against the dev DB, but the canonical signal is the deploy log.

### payment-hardening.AC6.2 — Migration is idempotent on re-run

- Type: `human-verification`
- File: Manual verification — re-run migration SQL twice against
  dev DB; expect zero errors.
- Notes: `CREATE UNIQUE INDEX IF NOT EXISTS` guarantees this at the SQL
  layer; verified operationally.

### payment-hardening.AC6.3 — Grants (NULL `autumn_checkout_id`) still insert repeatedly

- Type: `human-verification`
- File: Manual verification — `INSERT INTO stamp_lots (source='grant',
  autumn_checkout_id=NULL) ...` twice against dev DB.
- Notes: Partial-index `WHERE` clause exempts grants; verified
  operationally because this is a property of the index DDL, not of
  any TS code path.

### payment-hardening.AC7.1 — First `creditStampLot` call inserts lot + increments balance + appends txn

- Type: `unit`
- File: `test/us039-credit-stamp-lot-idempotent.test.ts`
- Notes: Mocked-client test asserting the BEGIN/INSERT/UPDATE/INSERT/
  COMMIT query sequence and the returned `{lotId, balanceAfter}`.

### payment-hardening.AC7.2 — Duplicate call throws `DuplicateStampCheckoutError`

- Type: `unit`
- File: `test/us039-credit-stamp-lot-idempotent.test.ts`
- Notes: Mock the lot INSERT to throw `{code: '23505'}`; assert
  `DuplicateStampCheckoutError` is raised and ROLLBACK was issued
  before any downstream queries ran.

### payment-hardening.AC7.3 — Concurrent calls: exactly one success, one duplicate, total delta = `count`

- Type: `human-verification`
- File: Manual verification (optional integration —
  `test/us039-credit-stamp-lot-idempotent.test.ts` can mock the
  race; only a real DB proves PG-level atomicity)
- Notes: A mocked `Promise.allSettled` test demonstrates control flow
  but does not exercise the underlying UNIQUE index. The authoritative
  proof requires a real Postgres race. Mocked version is recommended
  as a smoke test; flag the real-DB run as an operator gate.

### payment-hardening.AC8.1 — `creditGiftStampLot` first call: lot + balance + sender/recipient txns

- Type: `unit`
- File: `test/us039-credit-stamp-lot-idempotent.test.ts`
- Notes: Mirror of AC7.1 for the gift code path.

### payment-hardening.AC8.2 — `creditGiftStampLot` duplicate: throws + no mutation

- Type: `unit`
- File: `test/us039-credit-stamp-lot-idempotent.test.ts`
- Notes: Mirror of AC7.2.

### payment-hardening.AC8.3 — `creditGiftStampLot` concurrent: exactly one credit

- Type: `human-verification`
- File: Manual verification (or mocked race in
  `test/us039-credit-stamp-lot-idempotent.test.ts`)
- Notes: Same caveat as AC7.3 — only a real PG instance proves the
  index-level race resolution.

### payment-hardening.AC9.1 — Webhook maps `DuplicateStampCheckoutError` → `'already_credited'`

- Type: `unit`
- File: `test/us039-webhook-idempotent.test.ts`
- Notes: Mock `creditStampLot` to throw; assert handler returns
  `{handled: true, stamp_purchase: 'already_credited'}`.

### payment-hardening.AC9.2 — `hasStampCheckout` fast-path short-circuits credit functions

- Type: `unit`
- File: `test/us039-webhook-idempotent.test.ts`
- Notes: Spy on `creditStampLot`; assert it is NOT called when
  `hasStampCheckout` returns `true`.

### payment-hardening.AC9.3 — Pre-existing credited lot: end-to-end `'already_credited'`, no 5xx

- Type: `integration`
- File: `test/us039-webhook-idempotent.test.ts`
- Notes: Compose the webhook handler with mocked DB that simulates a
  prior credited lot. Asserts the end-to-end response shape.

---

## Phase 3 — Idempotent Resend bounce refund

### payment-hardening.AC10.1 — `refundFailedSend({client})` runs inside caller's tx

- Type: `unit`
- File: `test/us039-refund-failed-send-client.test.ts`
- Notes: Fake client records every `query` call; assert NO BEGIN/COMMIT/
  ROLLBACK/release and that the expected UPDATE/UPDATE/INSERT trio
  fires.

### payment-hardening.AC10.2 — `refundFailedSend` (no client) manages own tx

- Type: `unit`
- File: `test/us039-refund-failed-send-client.test.ts`
- Notes: Mock `db.pool.connect` returning a fake client; assert BEGIN,
  three queries, COMMIT, and `release()` all occur.

### payment-hardening.AC11.1 — Successful bounce refund returns `{refunded:true, balanceAfter}`

- Type: `unit`
- File: `test/us039-refund-postcard-bounce.test.ts`
- Notes: Mock the UPDATE…RETURNING to yield a row; assert COMMIT and
  the expected result.

### payment-hardening.AC11.2 — Already-refunded postcard: idempotent `{refunded:false, reason:'already_refunded'}`

- Type: `unit`
- File: `test/us039-refund-postcard-bounce.test.ts`
- Notes: Mock UPDATE returning `[]` and the classify SELECT returning
  `[{status:'failed_refunded'}]`. Assert NO lot/transaction mutation.

### payment-hardening.AC11.3 — Concurrent bounces: one wins, one reports already-refunded

- Type: `human-verification`
- File: Manual verification (mocked version in
  `test/us039-refund-postcard-bounce.test.ts`)
- Notes: Mocked test asserts control flow. Real PG required to prove
  the CAS atomicity under concurrent connections.

### payment-hardening.AC11.4 — Queued postcard: `{refunded:false, reason:'not_sent'}`

- Type: `unit`
- File: `test/us039-refund-postcard-bounce.test.ts`
- Notes: Defensive branch; mocked classify SELECT returns
  `[{status:'queued'}]`.

### payment-hardening.AC11.5 — Unknown id: `{refunded:false, reason:'not_sent'}`

- Type: `unit`
- File: `test/us039-refund-postcard-bounce.test.ts`
- Notes: Classify SELECT returns `[]`; assert null-postcard branch.

### payment-hardening.AC11.6 — Inner refund throws: ROLLBACK + status reverts

- Type: `unit`
- File: `test/us039-refund-postcard-bounce.test.ts`
- Notes: Mock `refundFailedSend` to throw post-CAS; assert ROLLBACK was
  called and no stamp_transactions row was written.

### payment-hardening.AC12.1 — First hard-bounce: 200 `{refunded:true}`, +1 stamp

- Type: `unit`
- File: `test/us033-resend-webhook-handler.test.ts`
- Notes: Existing happy-path test extended with the new
  `refundPostcardBounce` mock.

### payment-hardening.AC12.2 — Svix retry: `{refunded:false, reason:'already_refunded'}`

- Type: `unit`
- File: `test/us033-resend-webhook-handler.test.ts`
- Notes: New idempotency test; mock orchestrator to return
  `already_refunded`.

### payment-hardening.AC12.3 — Soft/transient bounces still no-op

- Type: `unit`
- File: `test/us033-resend-webhook-handler.test.ts`
- Notes: Regression coverage of pre-existing classification logic.

### payment-hardening.AC12.4 — Non-postcard emails return `not_a_postcard`

- Type: `unit`
- File: `test/us033-resend-webhook-handler.test.ts`
- Notes: Existing test, regression-only.

---

## Phase 4 — Postcard double-debit (CAS state machine)

### payment-hardening.AC13.1 — Migration 0016: `'debiting'` accepted in CHECK

- Type: `human-verification`
- File: Manual verification — `\d+ postcards` output contains
  `'debiting'` in the CHECK constraint.
- Notes: Operational verification of DDL.

### payment-hardening.AC13.2 — Migration is idempotent on re-run

- Type: `human-verification`
- File: Manual verification — re-run migration SQL twice; expect no
  error.
- Notes: DROP/ADD CONSTRAINT pattern; verified operationally.

### payment-hardening.AC13.3 — Existing rows remain valid post-migration

- Type: `human-verification`
- File: Manual verification — pre-migration row inventory matches
  post-migration row inventory.
- Notes: CHECK constraint is a superset of old; verified by inspection.

### payment-hardening.AC14.1 — CAS on queued row returns `{ok:true}`

- Type: `unit`
- File: `test/us039-transition-postcard-debiting.test.ts`
- Notes: Mock UPDATE returning a row; assert success result.

### payment-hardening.AC14.2 — CAS on already-debiting: `{ok:false, status:'debiting'}`

- Type: `unit`
- File: `test/us039-transition-postcard-debiting.test.ts`
- Notes: Mock UPDATE returning `[]`, observed SELECT returning the
  current status.

### payment-hardening.AC14.3 — CAS on sent: `{ok:false, status:'sent'}`

- Type: `unit`
- File: `test/us039-transition-postcard-debiting.test.ts`
- Notes: Same pattern as AC14.2 with `'sent'`.

### payment-hardening.AC14.4 — CAS on failed_refunded: `{ok:false, status:'failed_refunded'}`

- Type: `unit`
- File: `test/us039-transition-postcard-debiting.test.ts`
- Notes: Same pattern, `'failed_refunded'`.

### payment-hardening.AC14.5 — CAS on missing id: `{ok:false, status:null}`

- Type: `unit`
- File: `test/us039-transition-postcard-debiting.test.ts`
- Notes: Both UPDATE and SELECT return `[]`; assert null branch.

### payment-hardening.AC15.1 — Fresh send: queued → debiting → debit → sent, 200

- Type: `integration`
- File: `test/us039-postcard-cas.test.ts`
- Notes: Compose handler mocks; assert call ORDER (`transitionToDebiting`
  called before `debitStamp`).

### payment-hardening.AC15.2 — Resurrection single retry: 200 after stuck queued >10 min

- Type: `integration`
- File: `test/us039-postcard-cas.test.ts`
- Notes: Mock reused-queued-old branch + successful CAS; assert 200.

### payment-hardening.AC15.3 — Resurrection concurrent retries: one 200, one 409, exactly one debit

- Type: `human-verification`
- File: Manual verification (mocked control-flow test in
  `test/us039-postcard-cas.test.ts`)
- Notes: Plan explicitly states "the strongest version of this test
  requires a real Postgres test DB; the mocked version is a smoke test
  for control flow". Real-DB version is authoritative.

### payment-hardening.AC15.4 — Failed send: CAS → debit → refund → markFailedRefunded, 502

- Type: `integration`
- File: `test/us039-postcard-cas.test.ts`
- Notes: Mock `sendPostcardEmail` to throw; assert refund + status
  transition + 502.

### payment-hardening.AC15.5 — Reused sent: 200 cached balance, no CAS, no debit

- Type: `integration`
- File: `test/us039-postcard-cas.test.ts`
- Notes: Critical regression-prevention assertion — neither
  `transitionToDebiting` nor `debitStamp` should fire.

### payment-hardening.AC15.6 — Reused failed_refunded: 409 `send_previously_failed`

- Type: `integration`
- File: `test/us039-postcard-cas.test.ts`
- Notes: Assert CAS NOT called; preserves existing behavior.

### payment-hardening.AC15.7 — Reused debiting: 409 `send_in_progress` regardless of age

- Type: `integration`
- File: `test/us039-postcard-cas.test.ts`
- Notes: Closes the resurrection loophole. Critical regression-prevention.

### payment-hardening.AC15.8 — InsufficientStampsError recovery: rollback to queued, 402

- Type: `integration`
- File: `test/us039-postcard-cas.test.ts`
- Notes: Mock CAS success then `debitStamp` throw; assert
  `rollbackDebitingToQueued` is called and 402 returned.

---

## Phase 5 — CORS lockdown

### payment-hardening.AC16.1 — `netlify.toml` has no `Access-Control-Allow-Origin = "*"`

- Type: `unit`
- File: `test/us039-netlify-toml-headers.test.ts` (new — string-level
  assertion against the checked-in `netlify.toml`)
- Notes: A simple Node `fs.readFileSync('netlify.toml')` + regex assertion
  is sufficient. Alternative: `grep` in CI. Listing as `unit` because
  it can be expressed as a vitest test.

### payment-hardening.AC16.2 — `netlify.toml` has no `Access-Control-Allow-Credentials = "true"`

- Type: `unit`
- File: `test/us039-netlify-toml-headers.test.ts`
- Notes: Same pattern as AC16.1; trivial regex.

### payment-hardening.AC16.3 — Same-origin SPA → `/api/postcards/send` still works

- Type: `human-verification`
- File: Manual verification — open deploy preview, log in, send a
  postcard.
- Notes: Pre-existing endpoint integration tests already cover the
  server side; the "same-origin browser still works" half is by
  definition browser-policy and confirmed by smoke testing the preview.

### payment-hardening.AC16.4 — Cross-origin `fetch` blocked by browser default

- Type: `human-verification`
- File: Manual verification — DevTools console `fetch('/api/whoami',
  {credentials:'include'})` from a third-party origin should be
  blocked by SOP.
- Notes: This is enforced by the browser, not by our code. Curl can
  verify the headers are absent; the actual block is a browser policy.

---

## Phase 6 — Security headers

### payment-hardening.AC17.1 — HSTS header emitted

- Type: `unit`
- File: `test/us039-netlify-toml-headers.test.ts`
- Notes: Regex on `netlify.toml`. Header presence in production is best
  re-verified with `curl -sI` against the deploy preview (operator
  step), but the config-level assertion is automatable.

### payment-hardening.AC17.2 — `X-Frame-Options: DENY`

- Type: `unit`
- File: `test/us039-netlify-toml-headers.test.ts`
- Notes: Same as AC17.1.

### payment-hardening.AC17.3 — `X-Content-Type-Options: nosniff`

- Type: `unit`
- File: `test/us039-netlify-toml-headers.test.ts`
- Notes: Same as AC17.1.

### payment-hardening.AC17.4 — `Referrer-Policy: strict-origin-when-cross-origin`

- Type: `unit`
- File: `test/us039-netlify-toml-headers.test.ts`
- Notes: Same as AC17.1.

### payment-hardening.AC17.5 — Restrictive `Permissions-Policy`

- Type: `unit`
- File: `test/us039-netlify-toml-headers.test.ts`
- Notes: Regex for `Permissions-Policy` directive with the expected
  feature list.

### payment-hardening.AC18.1 — `Content-Security-Policy-Report-Only` present

- Type: `unit`
- File: `test/us039-netlify-toml-headers.test.ts`
- Notes: Config-file assertion. End-to-end CSP behavior is in AC18
  follow-ups.

### payment-hardening.AC18.2 — CSP allows `script-src 'self'`, `style-src 'self'`, `img-src 'self' data: blob:`, `connect-src 'self'`

- Type: `unit`
- File: `test/us039-netlify-toml-headers.test.ts`
- Notes: Regex on each directive substring.

### payment-hardening.AC18.3 — CSP allows `frame-src https://github.com`

- Type: `unit`
- File: `test/us039-netlify-toml-headers.test.ts`
- Notes: Regex match on `frame-src https://github.com`.

### payment-hardening.AC18.4 — CSP sets `frame-ancestors 'none'`

- Type: `unit`
- File: `test/us039-netlify-toml-headers.test.ts`
- Notes: Regex match.

### payment-hardening.AC18.5 — CSP sets `object-src 'none'`

- Type: `unit`
- File: `test/us039-netlify-toml-headers.test.ts`
- Notes: Regex match.

### payment-hardening.AC18.6 — CSP sets `base-uri 'self'` and `form-action 'self'`

- Type: `unit`
- File: `test/us039-netlify-toml-headers.test.ts`
- Notes: Regex match on both directives.

Additional Phase 6 CSP human-verification: After deploy, normal app
flow on the deploy preview must produce **zero CSP violations** in
DevTools console. That assertion cannot be automated in this repo
(requires running the SPA in a real browser against deploy preview
infrastructure). Track operationally per the phase doc's "Verification"
section.

### payment-hardening.AC19.1 — `json()` returns `Cache-Control: private, no-store`

- Type: `unit`
- File: `test/us039-http-cache-control.test.ts` (new — or assertion
  added to `test/us020-shares-record.test.ts` per phase doc)
- Notes: Call `json(200, {})`; assert header literal. Trivial.

### payment-hardening.AC19.2 — Existing call-site shapes unchanged

- Type: `unit`
- File: `test/us006-session-whoami.test.ts`,
  `test/us020-shares-precheck.test.ts`,
  `test/us020-shares-record.test.ts`,
  `test/us023-stamp-transactions-api.test.ts` (existing files; widen
  any header equality to `toMatchObject` per phase notes)
- Notes: Regression-prevention across the full test suite. Verified by
  `npx vitest run` exit code; no new file required.

---

## Phase 7 — Rate limiting

### payment-hardening.AC20.1 — `rate_limit_buckets` schema present

- Type: `human-verification`
- File: Manual verification — `psql "$DATABASE_URL" -c "\d+
  rate_limit_buckets"`.
- Notes: Operational DDL verification, same pattern as AC6.1 / AC13.1.

### payment-hardening.AC20.2 — Migration idempotent on re-run

- Type: `human-verification`
- File: Manual verification — re-run migration twice in dev.
- Notes: `CREATE TABLE IF NOT EXISTS` guarantees this; verified
  operationally.

### payment-hardening.AC21.1 — First call returns `{allowed:true, remaining:max-1, resetAt}` + count=1

- Type: `unit`
- File: `test/us039-rate-limit.test.ts`
- Notes: Mock `db.pool.query` to return the SQL's `RETURNING` row;
  assert helper math.

### payment-hardening.AC21.2 — Repeated calls within window: `remaining` decreases

- Type: `unit`
- File: `test/us039-rate-limit.test.ts`
- Notes: Sequence of mocked returns with increasing `count`; assert
  derived `remaining` matches.

### payment-hardening.AC21.3 — Over limit: `{allowed:false, remaining:0}`

- Type: `unit`
- File: `test/us039-rate-limit.test.ts`
- Notes: Mock returns `count > max`; assert `allowed:false`.

### payment-hardening.AC21.4 — Window rollover: count resets to 1, fresh `resetAt`

- Type: `unit`
- File: `test/us039-rate-limit.test.ts`
- Notes: Mock returns `count:1` with a fresh `window_start`; verify
  derived `resetAt`.

### payment-hardening.AC21.5 — Concurrent increments: count=2 (no lost update)

- Type: `human-verification`
- File: Manual verification (or mocked-counter test in
  `test/us039-rate-limit.test.ts`)
- Notes: Atomicity is a PG property of `ON CONFLICT DO UPDATE …
  RETURNING`. A mocked counter test asserts control flow; real-DB
  verification is authoritative.

### payment-hardening.AC21.6 — Sustained over-limit preserves `window_start`

- Type: `unit`
- File: `test/us039-rate-limit.test.ts`
- Notes: Mock sequence simulating same `window_start` across calls;
  assert helper does not reset until elapsed.

### payment-hardening.AC22.1 — `x-nf-client-connection-ip` header preferred

- Type: `unit`
- File: `test/us039-rate-limit.test.ts`
- Notes: Pure header-extraction helper test.

### payment-hardening.AC22.2 — `x-forwarded-for` fallback: first hop

- Type: `unit`
- File: `test/us039-rate-limit.test.ts`
- Notes: Pass `'1.2.3.4, 5.6.7.8'`; assert `'1.2.3.4'`.

### payment-hardening.AC22.3 — No headers: returns `'unknown'`

- Type: `unit`
- File: `test/us039-rate-limit.test.ts`
- Notes: Empty headers object; assert sentinel string.

### payment-hardening.AC23.1 — `/api/auth/login` per-IP 10/min: 11th returns 429

- Type: `unit`
- File: `test/us039-rate-limit-login.test.ts`
- Notes: Mock `checkAndIncrement` to return `allowed:false`; assert 429
  + headers. Under-limit path also covered.

### payment-hardening.AC23.2 — `/api/postcards/send` per-user 30/min

- Type: `integration`
- File: `test/us039-rate-limit-endpoints.test.ts`
- Notes: Compose handler with session mock + rate-limit mock; assert
  business logic mocks NOT called when 429.

### payment-hardening.AC23.3 — `/api/shares/confirm` per-user 30/min

- Type: `integration`
- File: `test/us039-rate-limit-endpoints.test.ts`
- Notes: Same pattern as AC23.2.

### payment-hardening.AC23.4 — `/api/billing/checkout` per-user 5/min

- Type: `integration`
- File: `test/us039-rate-limit-endpoints.test.ts`
- Notes: Same pattern.

### payment-hardening.AC23.5 — `/api/stamps/gifts/checkout` per-user 5/min

- Type: `integration`
- File: `test/us039-rate-limit-endpoints.test.ts`
- Notes: Same pattern.

### payment-hardening.AC23.6 — 429 response shape: `Retry-After`, `RateLimit-Policy`, `RateLimit`, body `{error:'rate_limited'}`

- Type: `unit`
- File: `test/us039-rate-limit.test.ts`
- Notes: Direct assertion against `rateLimitResponse(check, max,
  windowSeconds)` return value.

### payment-hardening.AC23.7 — Under-limit: existing status codes + bodies unchanged (regression)

- Type: `e2e`
- File: Full suite — `npx vitest run`
- Notes: All pre-existing handler tests must remain green after
  rate-limit wiring. The phase's verification command is the assertion;
  no new file required. Treated as an e2e gate because it covers the
  entire endpoint surface.

---

## Coverage stats

- 53 automated unit tests
- 7 automated integration tests
- 1 e2e (full-suite regression gate, AC23.7)
- 12 human-verification ACs (migrations, CSP browser violations,
  cross-origin SOP, concurrent-PG races)
- Total: 73 ACs across 7 phases
