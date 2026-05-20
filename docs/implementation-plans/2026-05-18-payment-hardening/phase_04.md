# Phase 4: Postcard double-debit (P1-6) Implementation Plan

**Goal:** Close the 10-minute "resurrection" double-debit window in `netlify/functions/postcards/send.ts:98-111`. Today, when a queued postcard >10 minutes old is encountered, the retry runs a fresh `debitStamp` on the **same** `postcard.id`; if the original send genuinely completes later, the user is debited twice for one postcard.

**Architecture:** Introduce a new `'debiting'` state in the `postcards.status` CHECK. The send handler must CAS-transition `queued → debiting` via `UPDATE postcards SET status='debiting' WHERE id=$1 AND status='queued' RETURNING id` **before** calling `debitStamp`. If the CAS returns zero rows, the postcard is no longer claimable (another concurrent request has it, or it transitioned out of band) — return `409 send_in_progress`. On success, `attachLotAndMarkSent` transitions `debiting → sent`; on Resend failure, `markFailedRefunded` transitions `debiting → failed_refunded`.

**Tech Stack:** Postgres 15+ (Netlify Database), TypeScript 5.8, `@netlify/functions`, `vitest`.

**Scope:** Phase 4 of 7.

**Codebase verified:** 2026-05-18.
- `postcards.status` (migration 0006): `CHECK (status IN ('queued','sent','failed_refunded'))`. Three values. No `'debiting'`.
- `findOrCreateQueuedPostcard` (`netlify/lib/postcards.ts:24-85`): ON CONFLICT `(sender_id, idempotency_key) WHERE idempotency_key IS NOT NULL` returns the existing row with `reused: true`. New rows arrive as `'queued'`.
- `attachLotAndMarkSent` (`netlify/lib/postcards.ts:87-102`): `UPDATE postcards SET status='sent', ... WHERE id=$3` — no status WHERE clause today. Will widen to `WHERE id=$3 AND status='debiting'` after Phase 4.
- `markFailedRefunded` (`netlify/lib/postcards.ts:104-118`): `WHERE id=$1 AND status IN ('sent','queued')` — widens to include `'debiting'`.
- `deleteIfQueued` (`netlify/lib/postcards.ts:133-142`): `DELETE WHERE id=$1 AND status='queued'` — unaffected (used only for the insufficient-stamps no-debit early-out).
- `send.ts:114-119` calls `debitStamp({ userId, referenceId: postcard.id })`. We will gate this with the CAS.
- Tests: `test/us011-send-route-ui.test.ts`, `test/us012-failed-send-refund.test.ts`, `test/us037-failed-send-refund-e2e.test.ts`, `test/us013-send-stamp-indicator.test.ts`. None exercise the 10-minute resurrection or concurrent-retry scenario. Phase 4 adds that.
- Phase 2 used migration 0015. Phase 3 added no migration. Phase 4's migration is **0016**.

---

## Acceptance Criteria Coverage

### payment-hardening.AC13: `'debiting'` state in `postcards.status`

- **payment-hardening.AC13.1 Success — migration applied:** After migration 0016, `postcards.status` CHECK accepts `IN ('queued','debiting','sent','failed_refunded')`.
- **payment-hardening.AC13.2 Defensive — idempotent re-run:** Re-running migration 0016 against an already-migrated DB is a no-op.
- **payment-hardening.AC13.3 No regression — existing rows:** Existing rows with `status='queued'`, `'sent'`, or `'failed_refunded'` remain valid post-migration.

### payment-hardening.AC14: Atomic CAS `queued → debiting`

- **payment-hardening.AC14.1 Success — claim queued:** `transitionPostcardToDebiting(id)` on a `'queued'` postcard returns `{ok: true}` and the row is now `'debiting'`.
- **payment-hardening.AC14.2 Failure — already debiting:** On a `'debiting'` postcard, returns `{ok: false, status: 'debiting'}` and the row is unchanged.
- **payment-hardening.AC14.3 Failure — already sent:** On a `'sent'` postcard, returns `{ok: false, status: 'sent'}`.
- **payment-hardening.AC14.4 Failure — already failed:** On a `'failed_refunded'` postcard, returns `{ok: false, status: 'failed_refunded'}`.
- **payment-hardening.AC14.5 Failure — not found:** On a missing id, returns `{ok: false, status: null}`.

### payment-hardening.AC15: Send handler gates `debitStamp` behind the CAS

- **payment-hardening.AC15.1 Happy path — fresh send:** Fresh `POST /api/postcards/send` → row inserted `'queued'` → CAS to `'debiting'` → `debitStamp` → `attachLotAndMarkSent` (`'debiting' → 'sent'`). Returns 200.
- **payment-hardening.AC15.2 Resurrection — single retry:** Stuck `'queued'` postcard >10 min old → CAS to `'debiting'` succeeds → debit → 'sent'. Returns 200.
- **payment-hardening.AC15.3 Resurrection — concurrent retries:** Two parallel retries on the same stuck `'queued'` postcard. Exactly one CAS wins → debits + sends. The other CAS fails → returns `409 send_in_progress`. Total stamps debited: 1.
- **payment-hardening.AC15.4 Failed send:** CAS to `'debiting'` → debit → Resend throws → `refundFailedSend` reverses the debit → `markFailedRefunded` (`'debiting' → 'failed_refunded'`). Returns 502.
- **payment-hardening.AC15.5 Idempotent reuse — sent:** Reused row with `status='sent'` returns 200 with cached balance (no new debit). Unchanged from today.
- **payment-hardening.AC15.6 Previously failed:** Reused row with `status='failed_refunded'` returns `409 send_previously_failed`. Unchanged from today.
- **payment-hardening.AC15.7 Reused debiting — in flight:** Reused row with `status='debiting'` returns `409 send_in_progress` regardless of `created_at`. (Closes the resurrection loophole: an in-flight debit cannot be re-claimed by age.)
- **payment-hardening.AC15.8 Recovery — InsufficientStampsError after CAS:** When `debitStamp` throws `InsufficientStampsError` after CAS to `'debiting'`, the row is rolled back to `'queued'` (not stuck in `'debiting'`). The user's `idempotency_key` remains claimable by a later retry.

---

## Tasks

<!-- START_TASK_1 -->
### Task 1: Migration 0016 — extend `postcards.status` CHECK

**Verifies:** payment-hardening.AC13.1, AC13.2, AC13.3 (infrastructure — operational verification)

**Files:**
- Create: `netlify/database/migrations/0016_postcards_debiting_state/migration.sql`
- Create: `netlify/database/migrations/0016_postcards_debiting_state/down.sql`

**Implementation:**

`netlify/database/migrations/0016_postcards_debiting_state/migration.sql`:

```sql
-- 0016_postcards_debiting_state
-- Adds a 'debiting' state to postcards.status. Used by the send handler
-- to atomically claim a postcard for debit via CAS:
--   UPDATE postcards SET status='debiting'
--   WHERE id=$1 AND status='queued' RETURNING id
--
-- This closes the 10-minute "resurrection" double-debit window: a retry
-- that arrives while the original send is still in flight will fail the
-- CAS and return 409 send_in_progress instead of running a second debit
-- on the same postcard.id.
--
-- The 'debiting' state is transient. Successful sends transition
-- 'debiting' -> 'sent' via attachLotAndMarkSent. Failed sends transition
-- 'debiting' -> 'failed_refunded' via markFailedRefunded.

BEGIN;

ALTER TABLE postcards
    DROP CONSTRAINT postcards_status_check;

ALTER TABLE postcards
    ADD CONSTRAINT postcards_status_check
    CHECK (status IN ('queued', 'debiting', 'sent', 'failed_refunded'));

COMMIT;
```

`netlify/database/migrations/0016_postcards_debiting_state/down.sql`:

```sql
-- Reverts 0016. Any rows currently in 'debiting' must be resolved
-- (manually rolled forward to 'sent' or 'failed_refunded') before
-- this down migration can apply, otherwise the new CHECK fails.
BEGIN;

ALTER TABLE postcards
    DROP CONSTRAINT postcards_status_check;

ALTER TABLE postcards
    ADD CONSTRAINT postcards_status_check
    CHECK (status IN ('queued', 'sent', 'failed_refunded'));

COMMIT;
```

**Verification:**

```sh
psql "$DATABASE_URL" -f netlify/database/migrations/0016_postcards_debiting_state/migration.sql
psql "$DATABASE_URL" -c "\d+ postcards" | grep postcards_status_check
```

Expected output contains `CHECK (status = ANY (ARRAY['queued'::text, 'debiting'::text, 'sent'::text, 'failed_refunded'::text]))`.

Spot check — try a manual insert with 'debiting':

```sh
psql "$DATABASE_URL" -c "INSERT INTO postcards (id, sender_id, drawing_id, recipient_email, status) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 't@t.t', 'debiting') RETURNING id;"
# (Will fail on the FK to users — that's expected. The point is that the
# CHECK constraint doesn't reject 'debiting'. A FK error tells us the
# CHECK passed.)
```

**Commit:** `feat(db): add 'debiting' state to postcards.status CHECK (migration 0016)`
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->

<!-- START_TASK_2 -->
### Task 2: Add `transitionPostcardToDebiting` + widen `attachLotAndMarkSent` / `markFailedRefunded`

**Verifies:** payment-hardening.AC14.1, AC14.2, AC14.3, AC14.4, AC14.5

**Files:**
- Modify: `netlify/lib/postcards.ts:19` (PostcardRow type) — add `'debiting'` to the status union
- Modify: `netlify/lib/postcards.ts:87-102` (`attachLotAndMarkSent`) — narrow the WHERE clause to `AND status='debiting'`
- Modify: `netlify/lib/postcards.ts:104-118` (`markFailedRefunded`) — extend the WHERE clause to include `'debiting'`
- Add: `transitionPostcardToDebiting` exported function in `netlify/lib/postcards.ts`
- Add: `rollbackDebitingToQueued` exported function in `netlify/lib/postcards.ts`
- Create: `test/us039-transition-postcard-debiting.test.ts` (unit, vitest)

**Implementation:**

Update `PostcardRow` (`:12-22`):

```ts
export type PostcardRow = {
    id:string;
    sender_id:string;
    drawing_id:string;
    recipient_email:string;
    lot_id:string|null;
    resend_email_id:string|null;
    status:'queued'|'debiting'|'sent'|'failed_refunded';
    idempotency_key:string|null;
    created_at:string;
}
```

Add the new function (append after `findOrCreateQueuedPostcard`):

```ts
export type TransitionToDebitingResult =
    | { ok:true }
    | { ok:false; status:PostcardRow['status']|null }

/**
 * Atomically claim a queued postcard for debit. Returns ok:true if the
 * CAS succeeded; the caller now owns the debit. Returns ok:false with
 * the observed status if the row was no longer 'queued' (already
 * 'debiting', 'sent', 'failed_refunded') or did not exist.
 *
 * The send handler calls this BEFORE debitStamp to close the
 * resurrection double-debit window (see migration 0016 notes).
 */
export async function transitionPostcardToDebiting (
    postcardId:string
):Promise<TransitionToDebitingResult> {
    const db = getDatabase()
    const result = await db.pool.query<{ status:string }>(`
        UPDATE postcards
        SET status = 'debiting',
            updated_at = now()
        WHERE id = $1
            AND status = 'queued'
        RETURNING status
    `, [postcardId])

    if (result.rows[0]) return { ok: true }

    const observed = await db.pool.query<{ status:string }>(
        `SELECT status FROM postcards WHERE id = $1`,
        [postcardId]
    )
    const status = observed.rows[0]?.status as
        PostcardRow['status']|undefined

    return { ok: false, status: status ?? null }
}
```

Update `attachLotAndMarkSent` to enforce the state machine (`:87-102`):

```ts
export async function attachLotAndMarkSent (
    postcardId:string,
    lotId:string,
    resendEmailId:string
):Promise<void> {
    const db = getDatabase()

    // Only the holder of the 'debiting' claim may transition to 'sent'.
    await db.pool.query(`
        UPDATE postcards
        SET lot_id = $1,
            resend_email_id = $2,
            status = 'sent',
            updated_at = now()
        WHERE id = $3
            AND status = 'debiting'
    `, [lotId, resendEmailId, postcardId])
}
```

Update `markFailedRefunded` to include `'debiting'` (`:104-118`):

```ts
/**
 * Transition a postcard from 'debiting' to 'failed_refunded'.
 *
 * CONTRACT: Only operates on rows currently in 'debiting' state. Rows in
 * any other state ('queued', 'sent', 'failed_refunded') are silently
 * no-op'd (UPDATE returns 0 rows; no error raised). This is intentional —
 * `markFailedRefunded` is called from the send-handler failure path AFTER
 * the queued->debiting CAS has already succeeded.
 *
 * For the bounce-webhook refund path, use `refundPostcardBounce` in
 * netlify/lib/postcards.ts which atomically pairs the CAS with the
 * refund.
 */
export async function markFailedRefunded (
    postcardId:string
):Promise<void> {
    const db = getDatabase()

    await db.pool.query(`
        UPDATE postcards
        SET status = 'failed_refunded',
            updated_at = now()
        WHERE id = $1 AND status = 'debiting'
    `, [postcardId])
}
```

Add the rollback helper for the InsufficientStampsError unwind (append after `transitionPostcardToDebiting`):

```ts
/**
 * Rolls a postcard back from 'debiting' to 'queued' when debitStamp
 * throws InsufficientStampsError after a successful CAS. The
 * idempotency_key remains claimable by a later retry (e.g., after
 * the user tops up stamps).
 *
 * If the row is no longer 'debiting' (e.g., another request completed
 * it to 'sent' or 'failed_refunded'), this is a no-op.
 */
export async function rollbackDebitingToQueued (
    postcardId:string
):Promise<void> {
    const db = getDatabase()
    await db.pool.query(`
        UPDATE postcards
        SET status = 'queued',
            updated_at = now()
        WHERE id = $1 AND status = 'debiting'
    `, [postcardId])
}
```

`deleteIfQueued` is unchanged — it still gates on `status='queued'` which is correct (it's only called for the InsufficientStampsError early-out, BEFORE the CAS).

**Testing:**

`test/us039-transition-postcard-debiting.test.ts` covers AC14:

- AC14.1: Mock UPDATE to return `[{status: 'debiting'}]`. Assert result `{ok: true}`.
- AC14.2: Mock UPDATE to return `[]`; mock observed SELECT to return `[{status:'debiting'}]`. Assert `{ok:false, status:'debiting'}`.
- AC14.3: Same pattern with `'sent'`.
- AC14.4: Same pattern with `'failed_refunded'`.
- AC14.5: Mock UPDATE `[]`, observed SELECT `[]`. Assert `{ok:false, status:null}`.

**Verification:**
```sh
npx vitest run test/us039-transition-postcard-debiting.test.ts
```

**Commit:** `feat(postcards): add transitionPostcardToDebiting + tighten attachLotAndMarkSent WHERE`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update send handler to CAS before debit

**Verifies:** payment-hardening.AC15.1, AC15.2, AC15.4, AC15.5, AC15.6, AC15.7

**Files:**
- Modify: `netlify/functions/postcards/send.ts:60-180` — insert the CAS step before `debitStamp`; tighten the reused-row branch

**Implementation:**

Update the body of the handler. The key change is at lines 75-127 (the reused-row matrix and the debit call). **Edit boundary:** Replace from the line `const { postcard, reused } = await postcardStore.findOrCreateQueuedPostcard(...)` through `if (postcard.status === 'queued') { ... // Fall through — proceed to CAS, which will arbitrate. }` (before the `// CAS:` comment).

Exact replacement block:

```ts
const { postcard, reused } =
    await postcardStore.findOrCreateQueuedPostcard({
        senderId: session.user.id,
        drawingId: input.drawing_id,
        recipientEmail: input.recipient_email,
        lotId: null,
        idempotencyKey: input.idempotency_key
    })

if (reused) {
    if (postcard.status === 'sent') {
        try {
            const balance = await getCurrentStampBalance(session.user.id)
            return json(200, { id: postcard.id, balance_after: balance })
        } catch (_err) {
            return json(404, { error: 'User not found.' })
        }
    }

    if (postcard.status === 'failed_refunded') {
        return json(409, { error: 'send_previously_failed' })
    }

    if (postcard.status === 'debiting') {
        // Already claimed by a prior in-flight request. The 'debiting'
        // state has no time-based escape hatch — the only way out is
        // 'sent' or 'failed_refunded' via the holder's completion path.
        return json(409, { error: 'send_in_progress' })
    }

    if (postcard.status === 'queued') {
        const createdAt = new Date(postcard.created_at)
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)

        if (createdAt >= tenMinutesAgo) {
            return json(409, { error: 'send_in_progress' })
        }
        // Fall through — proceed to CAS, which will arbitrate.
    }
}

// CAS: claim 'queued' -> 'debiting'. Only the winner debits.
const claim = await postcardStore.transitionPostcardToDebiting(
    postcard.id
)

if (!claim.ok) {
    if (claim.status === 'sent') {
        const balance = await getCurrentStampBalance(session.user.id)
        return json(200, { id: postcard.id, balance_after: balance })
    }
    if (claim.status === 'failed_refunded') {
        return json(409, { error: 'send_previously_failed' })
    }
    // 'debiting' or null — race lost; ask the client to retry.
    return json(409, { error: 'send_in_progress' })
}

let debit:{lotId:string; balanceAfter:number}
try {
    debit = await debitStamp({
        userId: session.user.id,
        referenceId: postcard.id
    })
} catch (err) {
    if (err instanceof InsufficientStampsError) {
        // We held the 'debiting' claim but ran out of stamps. Roll the
        // state back to queued so a subsequent attempt (after the user
        // tops up) can proceed via the same idempotency_key.
        // If this rollback fails, the row sticks at 'debiting' until the
        // operator sweep — see Operator notes. We do NOT wrap CAS+debit+rollback
        // in a single transaction because debitStamp already manages its own
        // transaction; double-wrapping would require restructuring debitStamp.
        await postcardStore.rollbackDebitingToQueued(postcard.id)
        return json(402, { error: 'insufficient_stamps' })
    }
    throw err
}

// ... (rest of the function — sendPostcardEmail, attachLotAndMarkSent,
// the catch block calling refundFailedSend + markFailedRefunded —
// unchanged from today's structure) ...
```

The `rollbackDebitingToQueued` helper is defined in Task 2 (`netlify/lib/postcards.ts`). Call it here in the `InsufficientStampsError` catch block (lines 345–350). This is the only reverse transition allowed in the state machine and runs only when the holder discovered `InsufficientStampsError` BEFORE actually debiting.

**Testing:** This task's coverage is in Task 4.

**Verification:**
```sh
npx tsc --noEmit && npm run lint
```

**Commit:** `feat(send): gate debitStamp behind queued->debiting CAS to close double-debit window`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: End-to-end tests for the new state machine

**Verifies:** payment-hardening.AC15.1, AC15.2, AC15.3, AC15.4, AC15.5, AC15.6, AC15.7, AC15.8

**Files:**
- Create: `test/us039-postcard-cas.test.ts` (integration, vitest)
- Modify: `test/us037-failed-send-refund-e2e.test.ts` if its mocks set `status='sent'` directly — they need to flow through `'debiting'` now

**Implementation:**

`test/us039-postcard-cas.test.ts` exercises the full send-handler state machine. Use the existing pattern from `test/us037-failed-send-refund-e2e.test.ts` (mocked `getDatabase()`).

Required scenarios:

- AC15.1 Happy path: `findOrCreateQueuedPostcard` returns `{reused:false, postcard:{status:'queued'}}`. Mock `transitionPostcardToDebiting` to return `{ok:true}`. Mock `debitStamp` returns `{lotId, balanceAfter:N}`. Mock `sendPostcardEmail` returns a resend id. Mock `attachLotAndMarkSent` succeeds. Assert 200 response and that `transitionPostcardToDebiting` was called BEFORE `debitStamp`.
- AC15.2 Resurrection success: `findOrCreateQueuedPostcard` returns `{reused:true, postcard:{status:'queued', created_at: '15 minutes ago'}}`. Mock CAS to return `{ok:true}`. Assert 200.
- AC15.3 Resurrection concurrent: Fire two `handler(event)` calls in parallel against an in-memory mock that returns `{ok:true}` for the FIRST `transitionPostcardToDebiting` call and `{ok:false, status:'debiting'}` for the second. Assert one resolves to 200 and one to 409 `send_in_progress`. The strongest version of this test requires a real Postgres test DB; the mocked version is a smoke test for the control-flow but does not exercise the underlying ON CONFLICT atomicity.
- AC15.4 Failed send + refund: Same as AC15.1 happy path through CAS + debit, then mock `sendPostcardEmail` to throw. Assert `refundFailedSend` is called, `markFailedRefunded` is called, response is 502. Then check the row's status is `'failed_refunded'` after the call sequence.
- AC15.5 Idempotent sent: `findOrCreateQueuedPostcard` returns `{reused:true, postcard:{status:'sent'}}`. Assert 200 with `balance_after` from `getCurrentStampBalance`, AND that NEITHER `transitionPostcardToDebiting` NOR `debitStamp` was called.
- AC15.6 Previously failed: `{reused:true, postcard:{status:'failed_refunded'}}`. Assert 409 `send_previously_failed`. Assert CAS NOT called.
- AC15.7 Reused debiting: `{reused:true, postcard:{status:'debiting', created_at: '15 minutes ago'}}`. Assert 409 `send_in_progress`. Assert CAS NOT called. (This is the key regression-prevention for the resurrection-window class of bug — `'debiting'` always means in-flight, never claimable.)
- AC15.8 InsufficientStampsError recovery: Mock `transitionPostcardToDebiting` to return `{ok:true}`, mock `debitStamp` to throw `InsufficientStampsError`. Assert `rollbackDebitingToQueued` is called, response is 402 `insufficient_stamps`, and the row's status is `'queued'` after the call (verifiable via a final SELECT).

**Verification:**
```sh
npx vitest run test/us039-postcard-cas.test.ts test/us037-failed-send-refund-e2e.test.ts test/us011-send-route-ui.test.ts test/us012-failed-send-refund.test.ts test/us013-send-stamp-indicator.test.ts
```
Expected: all pass.

**Commit:** `test(send): cover queued/debiting/sent CAS state machine end-to-end`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Update existing test fixtures for the new CAS step

**Verifies:** No regression in existing send-handler tests.

**Files:**
- Modify: `test/us011-send-route-ui.test.ts` — if mocks `findOrCreateQueuedPostcard`, add `transitionPostcardToDebiting` mock between it and `debitStamp`
- Modify: `test/us012-failed-send-refund.test.ts` — if mocks `findOrCreateQueuedPostcard`, add `transitionPostcardToDebiting` mock between it and `debitStamp`
- Modify: `test/us013-send-stamp-indicator.test.ts` — if mocks `findOrCreateQueuedPostcard`, add `transitionPostcardToDebiting` mock between it and `debitStamp`
- Modify: `test/us037-failed-send-refund-e2e.test.ts` — update the happy-path scenario (if present) to insert a `transitionPostcardToDebiting → {ok:true}` mock between `findOrCreateQueuedPostcard` and `debitStamp`

**Implementation:**

For each test file that mocks `postcardStore.findOrCreateQueuedPostcard(...)`, locate the mock that chains to `debitStamp`. Insert a new mock:

```ts
// Before (existing):
.mockResolvedValueOnce(debitStampResult)

// After (with new CAS):
.mockResolvedValueOnce({ ok: true })  // transitionPostcardToDebiting
.mockResolvedValueOnce(debitStampResult)
```

If the mock setup uses a different style (e.g., direct object mocking via `vi.spyOn`), adjust the pattern accordingly — the key is that `transitionPostcardToDebiting` should return `{ok:true}` immediately before `debitStamp` is called in the test.

**Verification:**
```sh
npx vitest run test/us011-send-route-ui.test.ts test/us012-failed-send-refund.test.ts test/us013-send-stamp-indicator.test.ts test/us037-failed-send-refund-e2e.test.ts
```

Expected: all pass without changes to test expectations.

**Commit:** `test(fixtures): insert transitionPostcardToDebiting mocks in existing send tests`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Full suite verification

**Verifies:** Phase 4 regression-free.

**Files:** none — verification only.

**Verification:**
```sh
npm run lint && npx vitest run
```

Spot check the new state machine is in production migrations:
```sh
grep -n "debiting" netlify/database/migrations/0016_postcards_debiting_state/migration.sql
grep -n "debiting" netlify/lib/postcards.ts
grep -n "transitionPostcardToDebiting" netlify/functions/postcards/send.ts
```
Expected: matches in all three.

**Commit:** none.
<!-- END_TASK_6 -->

---

## Phase 4 Done When

- Migration 0016 applied; `postcards.status` accepts `'debiting'`.
- `transitionPostcardToDebiting` exists; `attachLotAndMarkSent` enforces `WHERE status='debiting'`; `markFailedRefunded` accepts `'debiting'`; `rollbackDebitingToQueued` exists for the InsufficientStampsError unwind.
- `netlify/functions/postcards/send.ts` calls `transitionPostcardToDebiting` between `findOrCreateQueuedPostcard` and `debitStamp`. Resurrection branch falls through to CAS, which arbitrates.
- Tests cover concurrent retries on a stuck queued postcard and prove only one debit lands.
- `npm run lint && npx vitest run` is green.

## Operator notes

- Existing `'queued'` rows older than 10 minutes in production: the new code path will try to CAS them to `'debiting'` and proceed. The original (presumed dead) attempt has no way to interfere — it doesn't hold a DB lock between transactions. The CAS is the single arbitration point.
- Existing `'sent'`/`'failed_refunded'` rows: unaffected. No data migration required beyond the CHECK constraint change.
- Stuck `'debiting'` rows: If a send handler crashed between CAS and `rollbackDebitingToQueued` (or between CAS and `attachLotAndMarkSent` / `markFailedRefunded`), a postcard can sit at `status='debiting'` forever, locking out its idempotency_key. Recovery SQL:
  ```sql
  UPDATE postcards
  SET status = 'queued', updated_at = now()
  WHERE status = 'debiting' AND updated_at < now() - interval '15 minutes';
  ```
  Consider a scheduled function (similar to `refund-expired-gifts`) to sweep stale `'debiting'` rows nightly. Tracked as a Phase 4 follow-up.
