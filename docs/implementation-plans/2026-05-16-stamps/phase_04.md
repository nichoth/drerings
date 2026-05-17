# Phase 4: Coverage gaps + Autumn refund forensic log

**Goal:** Close the test-coverage gaps the audit identified, and add forensic logging around Autumn refund calls so operators can reconcile after the rare double-fault case (Autumn refund succeeded, local COMMIT failed) without rummaging through Netlify function logs.

**Architecture:** Tests are additive — they exercise the integrations Phase 1 and Phase 2 produce, plus edge cases in the existing refund formula that weren't covered. The forensic log is a new `autumn_refund_attempts` table written to inside `issueAutumnStampRefund`. Each call records `(checkoutId, amountCents, status, response, attempted_at)` before the HTTP call and updates `status` afterward. If COMMIT fails, the attempt row persists (it's written in an independent connection, outside the caller's transaction) so an operator can compare ledger entries against attempt rows and find the orphaned refund.

**Tech Stack:** Existing — `@netlify/database`, vitest. No new dependencies.

**Scope:** Phase 4 of 4. Last phase before the plan is complete.

**Codebase verified:** 2026-05-16

**Design source:** `/Users/nick/code/drerings/docs/pricing.md` lines 165–196 (refund flow), lines 190 ("If Autumn refund fails: reverse the local state changes (or flag for manual reconciliation)"), lines 269–275 (open questions on disputes/chargebacks).

---

## Acceptance Criteria Coverage

### stamps.AC12: Refund formula handles non-divisible prices
- **stamps.AC12.1 Cleanly divisible:** 25 stamps purchased for 1000 cents ($0.40/stamp); 15 remaining → refund 600 cents. (Already covered by existing tests — re-asserted here to lock the baseline.)
- **stamps.AC12.2 Indivisible: 60 stamps for 2000 cents:** ($0.333… per stamp; integer division rounds down per `Math.floor` in `calculateStampLotRefundCents`):
  - 60 remaining → refund 2000 cents (full refund, exact).
  - 59 remaining → refund `Math.floor(59 * 2000 / 60)` = 1966 cents.
  - 30 remaining → refund 1000 cents.
  - 7 remaining → refund `Math.floor(7 * 2000 / 60)` = 233 cents.
  - 1 remaining → refund `Math.floor(1 * 2000 / 60)` = 33 cents.
- **stamps.AC12.3 The rounding "saves" the seller:** Asserts the total refunds for a fully-debited lot can never exceed the original price (verified by spot-checking the 60/$20 case across all remaining counts — none can be combined to exceed 2000 cents).
- **stamps.AC12.4 Non-purchase lots return zero:** Grant and gift_received lots return `0` from `calculateStampLotRefundCents` regardless of `price_paid_cents` field value. (Reasserts existing behavior.)

### stamps.AC13: End-to-end failed-send paths covered
- **stamps.AC13.1 Synchronous blob failure refunds:** From Phase 1 — when `getDrawingImage` returns `null` or throws, the `/api/postcards/send` response is `502` and a `stamp_transactions` row with `reason='failed_send_refund'` exists.
- **stamps.AC13.2 Async hard bounce refunds:** From Phase 2 — when Resend POSTs `email.bounced` with `bounce.type='hard_bounce'`, the bounce webhook calls `refundFailedSend` and inserts a `failed_send_refund` row.
- **stamps.AC13.3 No double refund:** If the sync-failure path AND a Resend bounce both happen for the same `postcards.id` (unlikely but possible if Resend accepts internally and then bounces while the function is mid-cleanup), the second refund attempt is a no-op. Test by setting the postcard to `status='failed_refunded'` before invoking the bounce handler — the bounce handler should return `{refunded:false, reason:'already_refunded'}`.

### stamps.AC14: 30-day gift refund window is enforced at the boundary
- **stamps.AC14.1 Just inside window:** A gift created 29 days, 23 hours, 59 minutes ago with `hasFullLot=true` is refundable. (Refund attempt succeeds.)
- **stamps.AC14.2 Just outside window:** A gift created 30 days + 1 second ago is NOT refundable, even with `hasFullLot=true`. (Refund attempt rejects with the existing `StampLotNotRefundableError`.)
- **stamps.AC14.3 Inside window but partially used:** A gift created 1 day ago where the recipient has used 1 stamp (`hasFullLot=false`) is NOT refundable. (Confirms the "before recipient uses any" constraint from design line 208.)

### stamps.AC15: Every Autumn refund attempt is durably logged
- **stamps.AC15.1 Attempt row before HTTP call:** Calling `issueAutumnStampRefund({checkoutId, amountCents})` inserts a row into `autumn_refund_attempts` with `status='attempted'`, `attempted_at=now()`, `checkout_id=$checkoutId`, `amount_cents=$amountCents`, `request_id=<deterministic>` BEFORE the fetch to Autumn.
- **stamps.AC15.2 Success transitions to 'succeeded':** When the fetch returns 2xx, the row transitions to `status='succeeded'`, `responded_at=now()`, `http_status=200..299`. The function still resolves with `void`.
- **stamps.AC15.3 Failure transitions to 'failed':** When the fetch returns non-2xx, the row transitions to `status='failed'`, `responded_at=now()`, `http_status=<actual>`, `response_body=<truncated body>`. The function still throws (existing behavior preserved — callers see the same error).
- **stamps.AC15.4 Network error transitions to 'failed':** When the fetch itself throws (DNS error, timeout), the row transitions to `status='failed'`, `responded_at=now()`, `error_message=<error.message>`, `http_status=NULL`. The function rethrows.
- **stamps.AC15.5 Retry policy distinguishes prior outcomes (PREVENTS DOUBLE-REFUND):** The `request_id` is `${checkoutId}:${amountCents}` (the natural idempotency key — the same lot can only be refunded for a specific remaining count once). A second call with the same `(checkoutId, amountCents)` inspects the existing attempt row's status and behaves as follows:
  - `'succeeded'` → No-op. Resolve with void. Do NOT call Autumn. (Idempotent replay-safe.)
  - `'attempted'` and `attempted_at` is < 60 seconds ago → A previous call is in-flight. Throw `InFlightRefundAttemptError` so the caller can retry later; do NOT call Autumn (would double-charge if the in-flight call completes successfully).
  - `'attempted'` and `attempted_at` is ≥ 60 seconds ago → The previous call orphaned (function crashed before recording outcome). Treat as needing operator resolution: throw `OrphanedRefundAttemptError`. Do NOT call Autumn. (The operator inspects whether Autumn actually refunded and manually marks the row succeeded or failed.)
  - `'failed'` with `http_status` set to a 4xx (Autumn rejected our request without processing it) → Retry is safe. Call Autumn.
  - `'failed'` with `http_status` set to a 5xx or anything else with a body (Autumn may have processed before sending us a 5xx) → Throw `AmbiguousRefundAttemptError`. Do NOT auto-retry. (Operator decides.)
  - `'failed'` with `http_status` NULL (network error / timeout — Autumn may or may not have received the request) → Throw `AmbiguousRefundAttemptError`. Do NOT auto-retry. (Operator decides.)
- **stamps.AC15.6 Independent connection:** The attempt row is written in a separate `db.pool.query` (not inside the caller's `client.query` transaction). If the caller later ROLLBACKs, the attempt row survives — that's the whole point of forensic logging.
- **stamps.AC15.7 mock mode bypassed:** When `shouldUseMockCheckout()` returns true (existing test/dev code path, see `netlify/lib/billing.ts:247`), the function continues to return early with no HTTP call and no attempt row written. (Mock mode is "I'm not really doing this.")

---

## Codebase findings to encode into this phase

Verified during spot-checks (2026-05-16):

- `netlify/lib/stamps.ts:278–292` defines `calculateStampLotRefundCents(lot)`. Uses `Math.floor((remainingCount * pricePaidCents) / originalCount)` — integer division, rounds down. Returns 0 for non-purchase lots. This matches design line 169.
- `netlify/lib/billing.ts:244–262` defines `issueAutumnStampRefund({checkoutId, amountCents})`. Currently:
  - Returns void.
  - Throws `Error('Autumn refund failed.')` on non-2xx.
  - Honors `shouldUseMockCheckout()` for test/dev bypass.
  - Posts to `${getAutumnApiUrl()}/refunds` with `{checkout_id, amount_cents}`.
  - Does NOT send a request id or idempotency key. Autumn's behavior on duplicate POSTs is undocumented; assume it's NOT idempotent and protect ourselves with the attempt-row lookup.
- `netlify/lib/stamps.ts:823–920` (`refundPurchasedStampLot`) calls `options.issueRefund(...)` at line 901 **before** `COMMIT` at line 906. The audit incorrectly claimed it was the other way around. Order verified: state update → external call → commit. If issueRefund throws → ROLLBACK reverses local state. If issueRefund succeeds → COMMIT persists. If COMMIT fails after issueRefund succeeded → refund happened externally, local state was rolled back. That last case is the forensic-log motivation.
- `netlify/lib/stamps.ts:1142–1168` (`sentGiftSummary`) computes `refundable = hasFullLot && isInWindow && isPriceRefundable`. The 30-day window is `addUtcDays(createdAt, 30)`. We test the boundary directly.
- `netlify/lib/billing.ts:247` `shouldUseMockCheckout()` short-circuits Autumn calls when env is missing or in test. Must preserve this bypass.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Refund formula edge-case tests

**Verifies:** stamps.AC12.1, stamps.AC12.2, stamps.AC12.3, stamps.AC12.4.

**Files:**
- Create: `/Users/nick/code/drerings/test/us0NN-refund-calculation-edge-cases.test.ts`

**Implementation:**

The existing `test/us014-refund-calculation.test.ts` covers the cleanly-divisible Bundle case. This new test covers the Big Bundle (60 / $20.00) where the per-stamp price is $0.333… and integer division matters.

`StampLotRefundRow` (verified at `netlify/lib/stamps.ts:151-156`) has exactly four fields: `source`, `original_count`, `remaining_count`, `price_paid_cents`. Don't add fields the type doesn't declare — `tsc --noEmit` rejects extra properties on object literals.

```typescript
import { describe, expect, it } from 'vitest'
import { calculateStampLotRefundCents }
    from '../netlify/lib/stamps.js'
import type { StampLotRefundRow } from '../netlify/lib/stamps.js'

function bigBundleLot (remaining:number):StampLotRefundRow {
    return {
        source: 'purchase',
        original_count: 60,
        remaining_count: remaining,
        price_paid_cents: 2000
    }
}

describe('US-0NN refund formula edge cases (60 / $20.00)', () => {
    it('full refund of an untouched lot returns exactly 2000c', () => {
        expect(calculateStampLotRefundCents(bigBundleLot(60))).toBe(2000)
    })

    it('59 remaining returns 1966c (floored)', () => {
        // 59 * 2000 / 60 = 1966.666...; floor → 1966
        expect(calculateStampLotRefundCents(bigBundleLot(59))).toBe(1966)
    })

    it('30 remaining returns exactly 1000c', () => {
        expect(calculateStampLotRefundCents(bigBundleLot(30))).toBe(1000)
    })

    it('7 remaining returns 233c (floored)', () => {
        // 7 * 2000 / 60 = 233.333...; floor → 233
        expect(calculateStampLotRefundCents(bigBundleLot(7))).toBe(233)
    })

    it('1 remaining returns 33c (floored)', () => {
        // 1 * 2000 / 60 = 33.333...; floor → 33
        expect(calculateStampLotRefundCents(bigBundleLot(1))).toBe(33)
    })

    it('0 remaining returns 0', () => {
        expect(calculateStampLotRefundCents(bigBundleLot(0))).toBe(0)
    })

    it('rounding never overpays the seller', () => {
        // If a user buys 60, sends 30, refunds the rest, then somehow
        // (impossible today, but proves the invariant) the system could
        // never have paid out more than 2000c total.
        const usedRefund = calculateStampLotRefundCents(bigBundleLot(30))
        const remainingRefund = calculateStampLotRefundCents(
            bigBundleLot(30)
        )
        // 30 stamps "spent" + 30 stamps refunded = 30 * (2000/60) = 1000;
        // our refund formula returns 1000 for both halves, total 2000.
        // This is exact for this case but the inequality is the invariant.
        expect(usedRefund + remainingRefund).toBeLessThanOrEqual(2000)
    })

    it('grant lots return 0 regardless of price field', () => {
        const grantLot:StampLotRefundRow = {
            source: 'grant',
            original_count: 5,
            remaining_count: 5,
            price_paid_cents: 9999   // nonsense — grants have no price
        }
        expect(calculateStampLotRefundCents(grantLot)).toBe(0)
    })

    it('gift_received lots return 0', () => {
        const giftLot:StampLotRefundRow = {
            source: 'gift_received',
            original_count: 25,
            remaining_count: 25,
            price_paid_cents: 1000
        }
        expect(calculateStampLotRefundCents(giftLot)).toBe(0)
    })
})
```

**Verification:**

Run: `npm run test:e2e -- us0NN-refund-calculation-edge-cases`
Expected: all 9 cases pass.

Run: `npm run test:e2e -- us014-refund-calculation`
Expected: existing tests still pass (no regression).

**Commit:** `test(stamps): refund formula edge cases for non-divisible prices`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: End-to-end failed-send-refund regression tests

**Verifies:** stamps.AC13.1, stamps.AC13.2, stamps.AC13.3.

**Files:**
- Create: `/Users/nick/code/drerings/test/us0NN-failed-send-refund-e2e.test.ts`

**Implementation:**

Phase 1 added tests for `POST /api/postcards/send` failure paths; Phase 2 added tests for the bounce-handler library. This task ties them together as a regression suite that exercises the database side-effects end-to-end (still mocked at the pool layer, but with the actual lib functions composed).

```typescript
import { describe, expect, it, vi } from 'vitest'

// Re-use the createDbMock pattern from test/us004-refund-failed-send.test.ts.
// Each scenario sets up the mock, imports the lib modules fresh
// (vi.resetModules), and asserts the sequence of SQL calls.

describe('US-0NN end-to-end failed send refund (sync + async)', () => {
    it('blob failure path: sync refund + audit trail intact', async () => {
        // 1. Mock the pool so debitStamp succeeds.
        // 2. Mock getDrawingImage to throw 'blob unavailable'.
        // 3. Call the postcards/send handler.
        // 4. Assert response is 502 send_failed.
        // 5. Assert the mocked pool received TWO INSERTs into
        //    stamp_transactions — one for 'send' (delta=-1), one for
        //    'failed_send_refund' (delta=+1). Neither UPDATE nor DELETE.
        // 6. Assert markFailedRefunded was called.
    })

    it('hard bounce path: async refund through webhook', async () => {
        // 1. Mock the pool so getPostcardByResendEmailId returns a
        //    'sent' postcard with a lot_id.
        // 2. Mock the pool so refundFailedSend's UPDATEs succeed and
        //    its INSERT into stamp_transactions returns a row.
        // 3. Construct a signed Resend bounce payload (use the same
        //    Svix-signing helper the production code uses).
        // 4. POST to the webhook handler.
        // 5. Assert response is 200 {refunded:true}.
        // 6. Assert one INSERT into stamp_transactions with
        //    reason='failed_send_refund'. No UPDATE/DELETE on
        //    stamp_transactions.
    })

    it('double-fault: sync refund already happened, async bounce is no-op',
        async () => {
            // 1. Mock postcards row with status='failed_refunded'.
            // 2. POST a signed bounce.
            // 3. Assert response is 200 {refunded:false, reason:
            //    'already_refunded'}.
            // 4. Assert refundFailedSend was NOT called.
            // 5. Assert NO INSERT into stamp_transactions.
        })
})
```

Implement each `it()` body with the actual mock + import pattern used in `test/us004-refund-failed-send.test.ts:11–35` (createDbMock factory). For the second case, reuse the Svix-signing snippet from Phase 2's Task 4 smoke-test (it's deterministic — synthesize messageId, timestamp, body, HMAC them with a test secret, set headers).

**Verification:**

Run: `npm run test:e2e -- us0NN-failed-send-refund-e2e`
Expected: all three cases pass.

Run: `npm run test:e2e`
Expected: full suite passes (regression).

**Commit:** `test(stamps): end-to-end failed-send refund coverage (sync + async)`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: 30-day gift refund boundary tests

**Verifies:** stamps.AC14.1, stamps.AC14.2, stamps.AC14.3.

**Files:**
- Create: `/Users/nick/code/drerings/test/us0NN-gift-refund-boundary.test.ts`

**Implementation:**

The existing `test/us021-*-test.ts` covers gift refund happy paths; this test pins down the 30-day boundary specifically.

```typescript
import { describe, expect, it, beforeEach, vi } from 'vitest'

describe('US-0NN gift refund 30-day boundary', () => {
    const FIXED_NOW = new Date('2026-06-15T12:00:00Z').getTime()

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(FIXED_NOW)
    })

    it('refundable just inside the window (29d 23h 59m old)',
        async () => {
            // Construct a gift_received lot with created_at = 29d 23h
            // 59m before FIXED_NOW. hasFullLot = true. Call
            // sentGiftSummary or refundSentGiftStampLot — assert it's
            // marked refundable / the refund succeeds.
        })

    it('NOT refundable just outside the window (30d 1s old)',
        async () => {
            // Same setup but created_at = 30 days + 1 second ago.
            // Assert sentGiftSummary.refundable === false; refund call
            // throws StampLotNotRefundableError.
        })

    it('NOT refundable inside window but partially used',
        async () => {
            // created_at = 1 day ago. original_count=10, remaining=9
            // (recipient used 1 stamp). hasFullLot=false. Assert
            // refundable === false.
        })
})
```

The mocking pattern: `sentGiftSummary` reads from the pool; mock the pool to return the constructed row. For the `refundSentGiftStampLot` assertion in the second case, mock the pool's transactional client to return the row and assert the thrown error type.

Use the existing `vi.doMock('@netlify/database', ...)` pattern.

**Verification:**

Run: `npm run test:e2e -- us0NN-gift-refund-boundary`
Expected: all three cases pass.

**Commit:** `test(stamps): 30-day gift refund boundary cases`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-6) -->

<!-- START_TASK_4 -->
### Task 4: Migration `0009_autumn_refund_attempts`

**Verifies:** (schema for Task 5.)

**Files:**
- Create: `/Users/nick/code/drerings/netlify/database/migrations/0009_autumn_refund_attempts/migration.sql`
- Create: `/Users/nick/code/drerings/netlify/database/migrations/0009_autumn_refund_attempts/down.sql`

**Implementation:**

`migration.sql`:

```sql
-- Forensic log of every call to Autumn's refund endpoint. Survives the
-- caller's transaction (written via an independent connection) so that
-- if the local COMMIT fails after Autumn has already refunded, the
-- operator can compare ledger entries against attempt rows and find
-- the orphan.
--
-- The (checkout_id, amount_cents) pair acts as the natural idempotency
-- key: a particular lot with a particular remaining_count can only be
-- refunded once. The unique index lets Task 5's lookup return early on
-- a retry without re-calling Autumn.

CREATE TABLE autumn_refund_attempts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    checkout_id     text NOT NULL,
    amount_cents    integer NOT NULL CHECK (amount_cents > 0),
    request_id      text NOT NULL,        -- "${checkout_id}:${amount_cents}"
    status          text NOT NULL CHECK (status IN (
        'attempted', 'succeeded', 'failed'
    )),
    http_status     integer,
    response_body   text,                  -- truncated to 2KB at write time
    error_message   text,                  -- network error, if any
    attempted_at    timestamptz NOT NULL DEFAULT now(),
    responded_at    timestamptz
);

CREATE UNIQUE INDEX idx_autumn_refund_attempts_request
    ON autumn_refund_attempts(request_id);

-- For the operator dashboard: "show me everything that failed":
CREATE INDEX idx_autumn_refund_attempts_status
    ON autumn_refund_attempts(status, attempted_at DESC)
    WHERE status = 'failed';
```

`down.sql`:

```sql
DROP INDEX IF EXISTS idx_autumn_refund_attempts_status;
DROP INDEX IF EXISTS idx_autumn_refund_attempts_request;
DROP TABLE IF EXISTS autumn_refund_attempts;
```

**Verification:**

Run: `npx netlify db migrations apply`
Expected: applies cleanly.

Run: `npx netlify db query "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='autumn_refund_attempts' ORDER BY ordinal_position"`
Expected: 10 columns with the correct types.

Run: `npx netlify db query "SELECT indexname FROM pg_indexes WHERE tablename='autumn_refund_attempts'"`
Expected: 3 indexes (PK + the 2 explicit ones).

Test unique constraint:
```bash
npx netlify db query "
INSERT INTO autumn_refund_attempts (checkout_id, amount_cents, request_id, status)
    VALUES ('co_test', 600, 'co_test:600', 'attempted');
INSERT INTO autumn_refund_attempts (checkout_id, amount_cents, request_id, status)
    VALUES ('co_test', 600, 'co_test:600', 'attempted');
"
```
Expected: second INSERT fails (unique violation on request_id).

Cleanup:
```bash
npx netlify db query "DELETE FROM autumn_refund_attempts WHERE checkout_id='co_test'"
```

**Commit:** `feat(stamps): autumn_refund_attempts forensic log table`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Wrap `issueAutumnStampRefund` with attempt logging

**Verifies:** stamps.AC15.1, stamps.AC15.2, stamps.AC15.3, stamps.AC15.4, stamps.AC15.5, stamps.AC15.6, stamps.AC15.7.

**Files:**
- Modify: `/Users/nick/code/drerings/netlify/lib/billing.ts`
- Create: `/Users/nick/code/drerings/test/us0NN-autumn-refund-attempts.test.ts`

**Implementation:**

Rewrite `issueAutumnStampRefund` at `netlify/lib/billing.ts:244–262`. Add three new error classes (or sentinel error subclasses) so callers and operators can distinguish the ambiguity-bearing cases:

```typescript
import { getDatabase } from '@netlify/database'   // already imported

export class InFlightRefundAttemptError extends Error {
    constructor () { super('Autumn refund attempt in flight.') }
}
export class OrphanedRefundAttemptError extends Error {
    constructor () {
        super('Previous Autumn refund attempt orphaned; operator must resolve.')
    }
}
export class AmbiguousRefundAttemptError extends Error {
    constructor (cause:string) {
        super('Previous Autumn refund attempt outcome ambiguous: ' + cause)
    }
}

export async function issueAutumnStampRefund (
    options:AutumnStampRefundOptions
):Promise<void> {
    if (shouldUseMockCheckout()) return        // AC15.7: no-op in mock

    const requestId = `${options.checkoutId}:${options.amountCents}`
    const db = getDatabase()

    // AC15.6: this query goes through db.pool directly — NOT inside
    // any caller transaction. The attempt row survives caller ROLLBACK.
    // AC15.5: lookup-or-insert the attempt row. Behavior depends on
    // the prior status (decision table in the AC).
    const upsert = await db.pool.query<{
        id:string
        status:string
        http_status:number|null
        response_body:string|null
        attempted_at:string
    }>(`
        INSERT INTO autumn_refund_attempts
            (checkout_id, amount_cents, request_id, status)
        VALUES ($1, $2, $3, 'attempted')
        ON CONFLICT (request_id) DO UPDATE
            SET status = autumn_refund_attempts.status
        RETURNING id, status, http_status, response_body, attempted_at
    `, [options.checkoutId, options.amountCents, requestId])
    const attempt = upsert.rows[0]

    // Branch on prior outcome per AC15.5.
    if (attempt.status === 'succeeded') return

    if (attempt.status === 'attempted') {
        const ageMs = Date.now() - Date.parse(attempt.attempted_at)
        if (ageMs < 60_000) throw new InFlightRefundAttemptError()
        throw new OrphanedRefundAttemptError()
    }

    if (attempt.status === 'failed') {
        const http = attempt.http_status
        // Safe to retry: Autumn rejected without processing.
        const isSafeToRetry = http !== null && http >= 400 && http < 500
        if (!isSafeToRetry) {
            const cause = http === null ?
                'network error - autumn may have processed' :
                `http ${http} - autumn may have processed`
            throw new AmbiguousRefundAttemptError(cause)
        }
        // Reset the row to 'attempted' so we don't carry forward stale
        // http_status / response_body from the previous failure.
        await db.pool.query(`
            UPDATE autumn_refund_attempts
            SET status = 'attempted',
                attempted_at = now(),
                http_status = NULL,
                response_body = NULL,
                error_message = NULL,
                responded_at = NULL
            WHERE id = $1
        `, [attempt.id])
        // Fall through to the HTTP call below.
    }

    let httpStatus:number|null = null
    let responseBodyTruncated:string|null = null
    let errorMessage:string|null = null

    try {
        const response = await fetch(`${getAutumnApiUrl()}/refunds`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${getAutumnSecretKey()}`,
                'content-type': 'application/json',
                'idempotency-key': requestId    // belt + suspenders if Autumn honors it
            },
            body: JSON.stringify({
                checkout_id: options.checkoutId,
                amount_cents: options.amountCents
            })
        })

        httpStatus = response.status
        const bodyText = await response.text()
        responseBodyTruncated = bodyText.slice(0, 2000)

        if (!response.ok) {
            await markAttemptFailed(attempt.id, httpStatus,
                                    responseBodyTruncated, null)
            throw new Error('Autumn refund failed.')
        }

        await markAttemptSucceeded(attempt.id, httpStatus,
                                   responseBodyTruncated)
    } catch (err) {
        // Network error or thrown after marking failed above.
        if (httpStatus === null) {
            errorMessage = err instanceof Error ?
                err.message :
                String(err)
            await markAttemptFailed(attempt.id, null, null, errorMessage)
        }
        throw err
    }
}

async function markAttemptSucceeded (
    attemptId:string,
    httpStatus:number,
    body:string|null
):Promise<void> {
    const db = getDatabase()
    await db.pool.query(`
        UPDATE autumn_refund_attempts
        SET status = 'succeeded',
            http_status = $2,
            response_body = $3,
            responded_at = now()
        WHERE id = $1
    `, [attemptId, httpStatus, body])
}

async function markAttemptFailed (
    attemptId:string,
    httpStatus:number|null,
    body:string|null,
    errorMessage:string|null
):Promise<void> {
    const db = getDatabase()
    await db.pool.query(`
        UPDATE autumn_refund_attempts
        SET status = 'failed',
            http_status = $2,
            response_body = $3,
            error_message = $4,
            responded_at = now()
        WHERE id = $1
    `, [attemptId, httpStatus, body, errorMessage])
}
```

**Critical:** the function's THROW behavior is preserved exactly — callers (`refundPurchasedStampLot` in `stamps.ts:823–920`) catch and ROLLBACK on throw. Don't swallow the error.

**Note on the `ON CONFLICT ... DO UPDATE SET status = status` trick:** the no-op update makes `RETURNING` populated even when nothing actually changed, so the caller always gets back the attempt's current status. The alternative (separate SELECT then INSERT) has a race.

**Note on idempotency-key header:** sending it costs nothing and protects us if Autumn ever turns on idempotency support. Until they do, our own `(request_id)` unique index is the primary defense.

**Testing:**

`test/us0NN-autumn-refund-attempts.test.ts`:

- **AC15.1 attempt row before HTTP:** mock `getDatabase().pool.query` to capture all calls. Mock `fetch` to delay (return a never-resolving Promise initially). Call `issueAutumnStampRefund` without awaiting it. Assert the INSERT into `autumn_refund_attempts` has happened before fetch resolves.
- **AC15.2 success transitions:** mock fetch to return 200 OK with body `'{"ok":true}'`. Assert the UPDATE to `status='succeeded'` happens with `http_status=200`, `response_body='{"ok":true}'`.
- **AC15.3 HTTP failure transitions:** mock fetch to return 502 with body `'gateway timeout'`. Assert the UPDATE to `status='failed'` with `http_status=502, response_body='gateway timeout'`. Assert the function throws `'Autumn refund failed.'`.
- **AC15.4 network error transitions:** mock fetch to reject with `new Error('ECONNRESET')`. Assert the UPDATE to `status='failed'` with `http_status=NULL, error_message='ECONNRESET'`. Assert the function rethrows.
- **AC15.5 prior-status=succeeded:** mock the upsert to return `{status:'succeeded', http_status:200}`. Assert NO fetch call. Assert the function resolves with void.
- **AC15.5 prior-status=attempted (<60s old):** mock upsert to return `{status:'attempted', attempted_at:new Date(Date.now()-10_000).toISOString()}`. Assert NO fetch call. Assert the function throws `InFlightRefundAttemptError`.
- **AC15.5 prior-status=attempted (orphaned, >60s old):** mock upsert to return `{status:'attempted', attempted_at:new Date(Date.now()-120_000).toISOString()}`. Assert NO fetch call. Assert the function throws `OrphanedRefundAttemptError`.
- **AC15.5 prior-status=failed with 4xx (safe retry):** mock upsert to return `{status:'failed', http_status:422, response_body:'invalid amount'}`. Assert fetch IS called. Mock fetch to return 200; assert the row transitions to 'succeeded'.
- **AC15.5 prior-status=failed with 5xx (ambiguous):** mock upsert to return `{status:'failed', http_status:502, response_body:'gateway'}`. Assert NO fetch call. Assert the function throws `AmbiguousRefundAttemptError` with a message containing `502`.
- **AC15.5 prior-status=failed with null http_status (network error):** mock upsert to return `{status:'failed', http_status:null, error_message:'ECONNRESET'}`. Assert NO fetch call. Assert the function throws `AmbiguousRefundAttemptError` with a message containing `network error`.
- **AC15.6 independent connection:** structural — assert `db.pool.query` is called directly, not via a `client` from `pool.connect()`. This rules out the attempt-row write accidentally being inside a transaction. Inspect the mock's `connect` count to confirm.
- **AC15.7 mock mode:** set `process.env.AUTUMN_API_KEY = ''` (or whatever `shouldUseMockCheckout` checks). Assert function resolves immediately. Assert NO `pool.query` call, NO `fetch` call.

For AC15.6 and the existing happy path coverage, also re-run the existing `test/us014-billing-checkout-api.test.ts` and `test/us015-billing-webhook-api.test.ts` and assert they still pass (they exercise `issueAutumnStampRefund` indirectly via `refundPurchasedStampLot`).

**Verification:**

Run: `npm run test:e2e -- us0NN-autumn-refund-attempts`
Expected: all cases pass.

Run: `npm run test:e2e`
Expected: full suite (including the existing refund tests) passes.

Run: `npm run lint && npx tsc -p tsconfig.json --noEmit`
Expected: no new errors.

**Commit:** `feat(stamps): forensic log + idempotency for autumn refunds`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Operator playbook + final regression sweep

**Verifies:** None.

**Files:**
- Modify: `/Users/nick/code/drerings/README.md` (or `docs/operations.md`)
- (read-only sweep of the rest)

**Implementation:**

Add to the operations doc:

```markdown
### Reconciling failed Autumn refunds

The refund code path throws one of four errors that need different operator
responses:

- **"Autumn refund failed."** — Autumn rejected the request, no money moved.
  Auto-retried on the next refund attempt for the same lot.
- **`InFlightRefundAttemptError`** — Another refund is in flight (started in
  the last 60 seconds). Wait and retry; no operator action needed.
- **`OrphanedRefundAttemptError`** — A previous attempt started >60s ago and
  never recorded an outcome (function timed out / crashed). Check Autumn's
  dashboard for the request — if it processed, mark the row succeeded
  manually (steps below); if not, mark it failed.
- **`AmbiguousRefundAttemptError`** — A previous attempt got a 5xx or
  network error. Autumn may or may not have processed it. Check Autumn's
  dashboard and reconcile.

For the last two: find the orphaned/ambiguous attempts:

    SELECT id, checkout_id, amount_cents, http_status,
           response_body, error_message, attempted_at, responded_at
    FROM autumn_refund_attempts
    WHERE status = 'failed'
      AND attempted_at > now() - interval '30 days'
    ORDER BY attempted_at DESC;

Cross-reference each failed attempt against the stamp_transactions
ledger:

    SELECT * FROM stamp_transactions
    WHERE reason = 'refund'
      AND reference_id = '<checkout_id from the attempt row>'
    ORDER BY created_at DESC;

If a stamp_transactions row exists for that checkout_id, the local
state matches Autumn (good — the catch-and-rollback path worked). If
NO row exists but Autumn shows the refund in their dashboard, you
have an orphaned external refund; the local lot still shows stamps
as refundable and a customer could refund again. Manual steps:

1. INSERT the missing 'refund' stamp_transactions row.
2. UPDATE stamp_lots SET remaining_count = 0 for the affected lot.
3. UPDATE users SET stamps_balance to match.
4. UPDATE autumn_refund_attempts SET status = 'succeeded' for the
   attempt row.

The scheduled invariant check (Phase 3) will catch the drift on the
next run and write to stamp_invariant_alerts — that's your tripwire.
```

**Final sweep:**

Run: `npm run test:e2e`
Expected: full suite passes. New test files added in this phase plus all prior phases.

Run: `npm test` (esbuild + tapout)
Expected: passes.

Run: `npm run lint && npx tsc -p tsconfig.json --noEmit`
Expected: zero errors.

Run: `RUN_DB_INTEGRATION=1 npm run test:e2e` (if the integration tests from Phase 3 exist)
Expected: passes against the local Wasm Postgres.

Check the migration sequence:
```bash
ls netlify/database/migrations
```
Expected: 0001..0009, contiguous. If anything's out of order, fix.

Browser smoke test the whole feature end-to-end:
1. `npm start`
2. Sign in.
3. Buy a Starter pack via the buy modal.
4. Send a postcard to a real personal email. Confirm receipt of the PNG.
5. Refund the remaining stamps on the Starter pack.
6. Check `autumn_refund_attempts` — one row with `status='succeeded'`.
7. Check `stamp_transactions` — debit + refund rows.
8. Run the scheduled invariant function manually: `curl -X POST http://localhost:9999/.netlify/functions/verify-stamp-invariants`. Expected: `driftCount: 0`.

**Commit:** `docs(stamps): operator playbook for refund reconciliation`
<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_B -->

---

## Done when

- Refund formula edge-case tests pass for the 60/$20.00 Big Bundle.
- End-to-end failed-send refund tests cover sync (blob), async (bounce), and the double-fault case.
- 30-day gift refund boundary tests pin down the inside/outside/partial cases.
- Migration `0009_autumn_refund_attempts` is applied.
- `issueAutumnStampRefund` logs every attempt durably and is idempotent on `(checkout_id, amount_cents)`.
- The operator playbook explains how to reconcile orphaned refunds.
- Full regression suite passes. The manual browser smoke test succeeds end-to-end.

## Out of scope for Phase 4

- **Automated retry of failed Autumn refunds.** The attempt log makes manual retry trivial; an automated retry job is deferrable until incident pressure justifies it. (Failed refunds are rare.)
- **Feature flag for soft launch.** Not in this phase. The team has already moved past the "soft launch" window — the feature is live via the staging merge.
- **Dispute / chargeback handling.** Design lists this as an open question; out of scope until incident pressure.
- **Non-USD pricing / VAT.** Design lists these as out of scope for v1.
- **Stamp-from-balance gifting (Flow 2).** Design explicitly out of scope for v1.
