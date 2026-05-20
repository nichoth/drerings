# Phase 3: Idempotent Resend bounce refund (P1-2) Implementation Plan

**Goal:** Wrap the bounce-refund path in an atomic transaction with a CAS gate so Svix retries cannot double-refund stamps.

**Architecture:** Extend `refundFailedSend` with an optional `client?: DatabaseClient` parameter (mirroring `debitStamp(client?)` from `netlify/lib/stamps.ts:723-808`). Add a new orchestrator `refundPostcardBounce(postcardId)` in `netlify/lib/postcards.ts` (or `stamps.ts` — see Task 2) that runs one transaction: `UPDATE postcards SET status='failed_refunded' WHERE id=$1 AND status='sent' RETURNING sender_id, lot_id`. If zero rows, ROLLBACK and return `{refunded:false, reason:'already_refunded'}`. If a row returns, call `refundFailedSend({..., client})` on the locked transaction, COMMIT. `handleResendEvent` calls the orchestrator and no longer references `markFailedRefunded` for the bounce path.

**Tech Stack:** TypeScript 5.8 (ESM), Postgres via `@netlify/database`, `vitest`, Svix-signed Resend webhooks.

**Scope:** Phase 3 of 7.

**Codebase verified:** 2026-05-18.
- `refundFailedSend` (`netlify/lib/stamps.ts:810-866`) opens its own BEGIN/COMMIT/release cycle today. No `client?` param yet.
- `debitStamp(client?)` (`netlify/lib/stamps.ts:723-808`) is the proven model: when `client` is supplied, the function runs inside the caller's transaction without BEGIN/COMMIT/release.
- `recordShare` (`netlify/lib/shares.ts:153-322`) is the working composition pattern: client.connect → BEGIN → SELECT FOR UPDATE → conditional INSERT → `debitStamp({..., client})` → COMMIT.
- `handleResendEvent` (`netlify/lib/resend-webhook.ts:23-101`) currently calls `refundFailedSend({userId, lotId})` then `markFailedRefunded(postcard.id)` on separate connections (lines 92-96). The vulnerable sequence.
- `markFailedRefunded` (`netlify/lib/postcards.ts:104-118`) WHERE clause `status IN ('sent','queued')` — adequate for Phase 4's send-handler path; stays in place for that caller.
- Svix signature verification runs in the function handler (`netlify/functions/webhooks/resend.ts:14`) BEFORE parsing the body; the inner `handleResendEvent` is trust-after-verify.
- `test/us033-resend-webhook-handler.test.ts` exists and tests the signature/method/payload guards but **does not** cover Svix retry idempotency. Phase 3 adds that.
- `stamp_transactions` is append-only (migration 0007 triggers). We do NOT add a UNIQUE on `stamp_transactions`; the CAS sits on `postcards.status` instead, where no append-only trigger exists.
- Phase 4 will introduce 'debiting' state in migration 0016. This phase's CAS is forward-compatible with that change.

---

## Acceptance Criteria Coverage

### payment-hardening.AC10: `refundFailedSend` accepts a shared transaction client

- **payment-hardening.AC10.1 Success — with client:** `refundFailedSend({userId, lotId, client})` runs inside the caller's transaction. Does NOT issue `BEGIN`, `COMMIT`, `ROLLBACK`, or `release()` on `client`. Updates `stamp_lots.remaining_count`, `users.stamps_balance`, and inserts a `failed_send_refund` row in `stamp_transactions`. Returns `{lotId, balanceAfter}`.
- **payment-hardening.AC10.2 Success — without client (legacy):** `refundFailedSend({userId, lotId})` acquires its own client, runs `BEGIN/COMMIT/release` as before, returns the same shape. Backward-compatible with `netlify/functions/postcards/send.ts:161-164`.

### payment-hardening.AC11: `refundPostcardBounce` is atomic and idempotent

- **payment-hardening.AC11.1 Success — sent postcard:** For a postcard with `status='sent'` and a non-null `lot_id`, `refundPostcardBounce(postcardId)` transitions status to `'failed_refunded'`, refunds the lot, and returns `{refunded: true, balanceAfter}`.
- **payment-hardening.AC11.2 Idempotent — already refunded:** For a postcard with `status='failed_refunded'`, returns `{refunded: false, reason: 'already_refunded'}`. `stamps_balance` unchanged. `stamp_lots.remaining_count` unchanged. No additional `stamp_transactions` row.
- **payment-hardening.AC11.3 Concurrent — two simultaneous calls:** Two parallel `refundPostcardBounce` calls on the same `postcardId` resolve to exactly one `{refunded: true}` and one `{refunded: false}`. Total balance increase is exactly 1.
- **payment-hardening.AC11.4 Defensive — queued postcard:** For a postcard with `status='queued'` (a bounce on a never-sent postcard is impossible in practice but defensive), returns `{refunded: false, reason: 'not_sent'}` and does not mutate state.
- **payment-hardening.AC11.5 Defensive — unknown id:** For an unknown postcard id, returns `{refunded: false, reason: 'not_sent'}` and does not mutate state.
- **payment-hardening.AC11.6 Defensive — inner refund throws:** If `refundFailedSend({client})` throws after a successful CAS, the outer transaction ROLLBACKs and the postcard reverts to `'sent'`. Stamps balance unchanged. No `stamp_transactions` row written.

### payment-hardening.AC12: `handleResendEvent` uses the new orchestrator

- **payment-hardening.AC12.1 Success — first delivery:** A hard-bounce webhook for a 'sent' postcard returns `{received: true, refunded: true}` and credits 1 stamp.
- **payment-hardening.AC12.2 Idempotent — Svix retry:** A second delivery of the same hard-bounce returns `{received: true, refunded: false, reason: 'already_refunded'}`. Balance unchanged.
- **payment-hardening.AC12.3 No regression — soft/transient:** Soft/transient/unknown bounces still no-op as today (returns `{refunded: false, reason: 'transient'}`).
- **payment-hardening.AC12.4 No regression — not a postcard:** Bounces for emails Resend sends that aren't postcards (different email_id) still return `{refunded: false, reason: 'not_a_postcard'}`.

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Extend `refundFailedSend` with optional `client?` parameter

**Verifies:** payment-hardening.AC10.1, AC10.2

**Files:**
- Modify: `netlify/lib/stamps.ts:115-118` — extend `RefundFailedSendOptions` interface with optional `client`
- Modify: `netlify/lib/stamps.ts:810-866` — split into `refundFailedSend` (transaction-managing) and `refundFailedSendOnClient` (client-supplied) per the `debitStamp` pattern
- Create: `test/us039-refund-failed-send-client.test.ts` (unit, vitest)

**Implementation:**

Update the options type (`stamps.ts:115-118`):

```ts
export interface RefundFailedSendOptions {
    userId:string;
    lotId:string;
    /**
     * Optional caller-supplied Postgres client. When provided,
     * `refundFailedSend` runs INSIDE the caller's existing transaction:
     * it does NOT issue BEGIN/COMMIT/ROLLBACK and does NOT release the
     * client. Mirrors the `debitStamp(client?)` pattern.
     *
     * When omitted, `refundFailedSend` acquires its own client and
     * manages its own transaction (preserves legacy call-site behavior
     * in netlify/functions/postcards/send.ts).
     */
    client?:DatabaseClient;
}
```

Refactor the body (`:810-866`):

```ts
export async function refundFailedSend (
    options:RefundFailedSendOptions
):Promise<DebitStampResult> {
    if (options.client) {
        return refundFailedSendOnClient(options.client, options)
    }

    const db = getDatabase()
    const client = await db.pool.connect() as DatabaseClient

    try {
        await client.query('BEGIN')
        const result = await refundFailedSendOnClient(client, options)
        await client.query('COMMIT')
        return result
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
    } finally {
        client.release()
    }
}

async function refundFailedSendOnClient (
    client:DatabaseClient,
    options:RefundFailedSendOptions
):Promise<DebitStampResult> {
    await client.query(`
        UPDATE stamp_lots
        SET remaining_count = remaining_count + 1
        WHERE id = $1
            AND user_id = $2
    `, [options.lotId, options.userId])

    const balanceResult = await client.query<BalanceRow>(`
        UPDATE users
        SET stamps_balance = stamps_balance + 1
        WHERE id = $1
        RETURNING stamps_balance
    `, [options.userId])
    const balanceAfter = Number(balanceResult.rows[0].stamps_balance)

    await client.query(`
        INSERT INTO stamp_transactions (
            user_id,
            lot_id,
            delta,
            reason,
            reference_id,
            balance_after
        )
        VALUES ($1, $2, $3, $4, $5, $6)
    `, [
        options.userId,
        options.lotId,
        1,
        'failed_send_refund',
        undefined,
        balanceAfter
    ])

    return { lotId: options.lotId, balanceAfter }
}
```

This is a mechanical split. Existing tests against `refundFailedSend({userId, lotId})` (no client) must continue to pass without change.

**Testing:**

`test/us039-refund-failed-send-client.test.ts` covers AC10:

- AC10.1: Build a fake client with stubbed `query` recording all calls. Call `refundFailedSend({userId, lotId, client: fake})`. Assert: NO `BEGIN`/`COMMIT`/`ROLLBACK` calls; the three expected UPDATE/UPDATE/INSERT queries appear; `release()` NOT called; result shape `{lotId, balanceAfter}`.
- AC10.2: Mock `db.pool.connect` to return a fake client. Call `refundFailedSend({userId, lotId})` (no client param). Assert: `BEGIN`, three queries, `COMMIT`, `release()` ALL called.

**Verification:**
```sh
npx vitest run test/us039-refund-failed-send-client.test.ts test/us012-failed-send-refund.test.ts test/us037-failed-send-refund-e2e.test.ts
```
Expected: new test passes; existing tests unchanged.

**Commit:** `refactor(stamps): refundFailedSend accepts optional shared client (mirrors debitStamp)`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add `refundPostcardBounce(postcardId)` orchestrator

**Verifies:** payment-hardening.AC11.1, AC11.2, AC11.3, AC11.4, AC11.5, AC11.6

**Files:**
- Modify: `netlify/lib/stamps.ts:7-13` — change `DatabaseClient` and `QueryResult` declarations from `interface` to `export interface`
- Modify: `netlify/lib/postcards.ts` — add new exported function `refundPostcardBounce`
- Create: `test/us039-refund-postcard-bounce.test.ts` (unit + integration, vitest)

**Implementation:**

First, in `netlify/lib/stamps.ts` (lines 7–13), export the shared types:

```ts
export interface QueryResult<Row> {
    rows:Row[];
}

export interface DatabaseClient {
    query:<Row = Record<string, unknown>>(
        sql:string,
        params?:unknown[]
    ) => Promise<QueryResult<Row>>;
    release:() => void;
}
```

Then append to `netlify/lib/postcards.ts` after `markFailedRefunded`:

```ts
import { refundFailedSend, type DatabaseClient, type QueryResult } from './stamps.js'

export type RefundPostcardBounceResult =
    | { refunded:true; balanceAfter:number }
    | { refunded:false; reason:'already_refunded'|'not_sent' }

/**
 * Atomic CAS + refund for the Resend bounce webhook path.
 *
 * Runs one transaction:
 *   1. UPDATE postcards SET status='failed_refunded'
 *        WHERE id=$1 AND status='sent' RETURNING sender_id, lot_id
 *   2. If zero rows: ROLLBACK, return { refunded:false, reason }
 *   3. Else: refundFailedSend({ ..., client }), COMMIT
 *
 * Idempotent under Svix retries — the CAS atomically claims the
 * "sent → failed_refunded" transition. Concurrent attempts have
 * exactly one winner.
 */
export async function refundPostcardBounce (
    postcardId:string
):Promise<RefundPostcardBounceResult> {
    const db = getDatabase()
    const client = await db.pool.connect() as DatabaseClient

    try {
        await client.query('BEGIN')

        // resend_email_id and status='sent' are written atomically by
        // attachLotAndMarkSent — finding the postcard by resend_email_id
        // implies status='sent'. The 'debiting' allowance is forward-compat
        // with Phase 4 in case future state-machine changes ever allow
        // resend_email_id to be set during 'debiting'.
        const updated = await client.query<{
            sender_id:string;
            lot_id:string|null;
        }>(`
            UPDATE postcards
            SET status = 'failed_refunded',
                updated_at = now()
            WHERE id = $1
                AND status IN ('sent', 'debiting')
                AND lot_id IS NOT NULL
            RETURNING sender_id, lot_id
        `, [postcardId])

        if (!updated.rows[0]) {
            await client.query('ROLLBACK')
            return classifyMissedRefund(postcardId, db.pool)
        }

        const { sender_id: senderId, lot_id: lotId } = updated.rows[0]

        if (!lotId) {
            // Defensive: WHERE clause already guarded against null lot_id,
            // but TypeScript can't prove it.
            await client.query('ROLLBACK')
            return { refunded: false, reason: 'not_sent' }
        }

        const { balanceAfter } = await refundFailedSend({
            userId: senderId,
            lotId,
            client
        })

        await client.query('COMMIT')

        return { refunded: true, balanceAfter }
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
    } finally {
        client.release()
    }
}

async function classifyMissedRefund (
    postcardId:string,
    pool:{ query:(sql:string, params?:unknown[]) => Promise<QueryResult<{status:string}>> }
):Promise<RefundPostcardBounceResult> {
    const result = await pool.query<{ status:string }>(
        `SELECT status FROM postcards WHERE id = $1`,
        [postcardId]
    )
    const status = result.rows[0]?.status

    if (status === 'failed_refunded') {
        return { refunded: false, reason: 'already_refunded' }
    }
    return { refunded: false, reason: 'not_sent' }
}
```

**Testing:**

`test/us039-refund-postcard-bounce.test.ts` covers AC11:

- AC11.1: Mock client.query for `UPDATE postcards … RETURNING` to return `[{sender_id, lot_id}]`. Mock subsequent `refundFailedSend` queries. Assert result `{refunded:true, balanceAfter}` and that COMMIT was called.
- AC11.2: Mock the UPDATE to return `[]` (CAS missed). Mock `pool.query` for the classifyMissedRefund SELECT to return `[{status:'failed_refunded'}]`. Assert result `{refunded:false, reason:'already_refunded'}`. Assert NO calls to `stamp_lots` UPDATE or `stamp_transactions` INSERT.
- AC11.3: Spawn two `refundPostcardBounce(id)` promises in parallel against a real DB (use the existing integration-test scaffolding from `test/us037-failed-send-refund-e2e.test.ts` — copy the setup). Assert `Promise.allSettled` yields one `refunded:true` and one `refunded:false` with `reason:'already_refunded'`, and that the user's `stamps_balance` increased by exactly 1.
- AC11.4: Mock UPDATE to return `[]` and classifyMissedRefund SELECT to return `[{status:'queued'}]`. Assert `{refunded:false, reason:'not_sent'}`.
- AC11.5: Mock UPDATE to return `[]` and classifyMissedRefund SELECT to return `[]` (no row). Assert `{refunded:false, reason:'not_sent'}`.
- AC11.6 (NEW): Mock the UPDATE to return `[{sender_id, lot_id}]`, then have the mock `refundFailedSend` throw. Assert that ROLLBACK was called before the throw, postcard status remains `'sent'` (revert), and `stamp_lots.remaining_count` unchanged.

**Verification:**
```sh
npx vitest run test/us039-refund-postcard-bounce.test.ts
```
Expected: 5 tests pass.

**Commit:** `feat(postcards): atomic refundPostcardBounce orchestrator with CAS gate`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Update `handleResendEvent` to use `refundPostcardBounce`

**Verifies:** payment-hardening.AC12.1, AC12.2, AC12.3, AC12.4

**Files:**
- Modify: `netlify/lib/resend-webhook.ts:1-101` — replace the refund + mark sequence with a single `refundPostcardBounce` call; widen the result type
- Modify: `test/us033-resend-webhook-handler.test.ts` — add Svix-retry idempotency test (AC12.2) and verify AC12.3/AC12.4 regress-free

**Implementation:**

Replace the bottom of `handleResendEvent` (`resend-webhook.ts:68-101`):

```ts
import { refundPostcardBounce } from './postcards.js'

export type ResendWebhookResult = {
    received:true;
    refunded:boolean;
    reason?:
        | 'transient'
        | 'not_a_postcard'
        | 'already_refunded'
        | 'unhandled_event';
}

// ... (existing classify/early-return logic unchanged) ...
// Note: the pre-check at resend-webhook.ts:76-82 returns 'already_refunded'
// if the postcard is already at 'failed_refunded'. Both the early-out and
// refundPostcardBounce's classifyMissedRefund return the same reason on
// Svix retry. The early-out is the cheap path; the CAS is the correctness
// gate.

    const postcard = await getPostcardByResendEmailId(emailId)
    if (!postcard) {
        return {
            received: true,
            refunded: false,
            reason: 'not_a_postcard'
        }
    }

    const result = await refundPostcardBounce(postcard.id)

    if (result.refunded) {
        return { received: true, refunded: true }
    }

    if (result.reason === 'already_refunded') {
        return {
            received: true,
            refunded: false,
            reason: 'already_refunded'
        }
    }

    // 'not_sent' — postcard was 'queued' or missing. Treat as not-a-postcard
    // for the webhook response since there's nothing to refund.
    return {
        received: true,
        refunded: false,
        reason: 'not_a_postcard'
    }
```

Remove the import of `refundFailedSend` and `markFailedRefunded` from `resend-webhook.ts` (no longer used here — `send.ts` still imports both, that's fine).

**Testing:**

Extend `test/us033-resend-webhook-handler.test.ts`:

- AC12.1: Existing happy-path test should now exercise `refundPostcardBounce` mock. Update its mock setup if needed; assertion still `refunded: true`.
- AC12.2 (NEW): Mock `refundPostcardBounce` to return `{refunded:false, reason:'already_refunded'}`. Send the hard-bounce webhook. Assert response is `{received:true, refunded:false, reason:'already_refunded'}`. (This is the Svix-retry case.)
- AC12.3: Existing soft/transient/unknown bounce tests should pass without change.
- AC12.4: Existing `getPostcardByResendEmailId → null` test should pass without change.

**Verification:**
```sh
npx vitest run test/us033-resend-webhook-handler.test.ts
```
Expected: all tests pass including the new AC12.2 case.

**Commit:** `feat(webhook): resend bounce path is atomic and Svix-retry-safe`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Full suite verification

**Verifies:** Phase 3 regression-free.

**Files:** none — verification only.

**Verification:**
```sh
npm run lint && npx vitest run
```
Expected: lint passes; all tests pass; new tests cover AC10/AC11/AC12.

```sh
grep -rn "markFailedRefunded" netlify/lib/resend-webhook.ts
```
Expected: no matches (callers consolidated through `refundPostcardBounce`).

**Commit:** none.
<!-- END_TASK_4 -->

---

## Phase 3 Done When

- `refundFailedSend` accepts an optional `client?` and behaves correctly with and without it.
- `refundPostcardBounce` exists in `netlify/lib/postcards.ts` and is the sole entry point used by the Resend bounce webhook.
- `handleResendEvent` no longer calls `refundFailedSend` + `markFailedRefunded` non-transactionally.
- Tests cover first-delivery, Svix-retry (idempotent), concurrent-race, and the no-op classifications.
- `npm run lint && npx vitest run` is green.

## Notes for Phase 4 (postcard resurrection)

`markFailedRefunded` is no longer called from the resend webhook after this phase, but `netlify/functions/postcards/send.ts:166` still uses it on the sync failure path. **Do not delete `markFailedRefunded`** in this phase. Phase 4 reorganizes the send-handler state machine and will revisit it.
