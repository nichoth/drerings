# Phase 2: Idempotent Autumn webhook credit (P1-1) Implementation Plan

**Goal:** Prevent double-credit when Autumn (Svix) delivers a `checkout.completed` event more than once for the same checkout. Today `hasStampCheckout()` and `creditStampLot()`/`creditGiftStampLot()` run on separate connections with no lock between them; two concurrent retries both pass the check and both credit.

**Architecture:** Add a partial UNIQUE index on `stamp_lots.autumn_checkout_id` covering only `source IN ('purchase','gift_received')` rows. Make `creditStampLot` and `creditGiftStampLot` map Postgres error 23505 from the lot INSERT to a sentinel that callers translate to `'already_credited'`. The existing `hasStampCheckout` becomes a fast-path optimization — no longer load-bearing for correctness.

**Tech Stack:** Postgres 15+ (Netlify Database), TypeScript 5.8, `@netlify/database`, `vitest`.

**Scope:** Phase 2 of 7.

**Codebase verified:** 2026-05-18.
- `stamp_lots` (migration 0003): `id, user_id, source, original_count, remaining_count, price_paid_cents, autumn_checkout_id, gifted_by_user_id, created_at`. **No UNIQUE on `autumn_checkout_id` today.** `source` CHECK is `IN ('purchase','grant','gift_received')`.
- `stamp_transactions` append-only triggers (migration 0007) — `BEFORE UPDATE` and `BEFORE DELETE` raise. **Critical confirmation:** Postgres `INSERT … ON CONFLICT … DO UPDATE` fires the `BEFORE UPDATE` trigger on the conflicting row's update path. We therefore do **not** use `ON CONFLICT … DO UPDATE` on `stamp_transactions`. Lot dedup via UNIQUE on `stamp_lots` (no trigger on that table) and surface the 23505 to the caller.
- `pending_gifts.autumn_checkout_id` already has UNIQUE (migration 0004, line 18-19). That dedup is already in place for the pending-gift path.
- `creditStampLot` (`netlify/lib/stamps.ts:506-574`) and `creditGiftStampLot` (`netlify/lib/stamps.ts:619-721`) each run an explicit BEGIN/COMMIT.
- `hasStampCheckout` (`netlify/lib/billing.ts:489-504`) runs on `db.pool.query` (separate connection from credit transaction).
- Postgres `23505` handler precedent exists at `netlify/lib/shares.ts:317-322`.
- Latest migration: `0014`. Next: `0015`.
- `test/us017-gift-stamp-webhook.test.ts` is `describe.skip` (Phase 1 will un-skip it; Phase 2 extends it).

---

## Acceptance Criteria Coverage

### payment-hardening.AC6: Migration 0015 adds partial UNIQUE

- **payment-hardening.AC6.1 Success:** `CREATE UNIQUE INDEX idx_stamp_lots_autumn_checkout_purchase ON stamp_lots(autumn_checkout_id) WHERE source IN ('purchase','gift_received') AND autumn_checkout_id IS NOT NULL` exists after migration.
- **payment-hardening.AC6.2 Defensive:** Migration is idempotent — re-running migration 0015 against an already-migrated DB is a no-op (uses `CREATE UNIQUE INDEX IF NOT EXISTS`).
- **payment-hardening.AC6.3 No regression — grants:** `INSERT INTO stamp_lots (source='grant', autumn_checkout_id=NULL)` works repeatedly (UNIQUE only covers `purchase`/`gift_received` with non-NULL `autumn_checkout_id`).

### payment-hardening.AC7: `creditStampLot` is idempotent on Autumn checkout ID

- **payment-hardening.AC7.1 Success — first call:** `creditStampLot({source:'purchase', autumnCheckoutId:'cs_1', count:10, ...})` inserts a lot, increments `stamps_balance` by 10, appends a `'purchase'` transaction. Returns `{lotId, balanceAfter}`.
- **payment-hardening.AC7.2 Success — duplicate call:** A second `creditStampLot` with the same `autumnCheckoutId` throws a new typed error `DuplicateStampCheckoutError`. `stamps_balance` is unchanged; no new lot row; no new transaction.
- **payment-hardening.AC7.3 Success — concurrent calls:** Two `creditStampLot` calls running in parallel with the same `autumnCheckoutId` complete with exactly one success and one `DuplicateStampCheckoutError`. Total balance change is exactly `count`, not `2 * count`.

### payment-hardening.AC8: `creditGiftStampLot` is idempotent

- **payment-hardening.AC8.1 Success — first call:** Inserts a `'gift_received'` lot, increments recipient's balance, appends recipient's `'gift_received'` transaction AND sender's `'gift_sent'` transaction (delta=0).
- **payment-hardening.AC8.2 Success — duplicate call:** Second call with same `autumnCheckoutId` throws `DuplicateStampCheckoutError`. No balance change. No additional transactions.
- **payment-hardening.AC8.3 Success — concurrent calls:** Two parallel calls produce exactly one credit and one `DuplicateStampCheckoutError`.

### payment-hardening.AC9: Webhook handler maps duplicates to `'already_credited'`

- **payment-hardening.AC9.1 Success:** `applyStampCheckout` catches `DuplicateStampCheckoutError` from `creditStampLot` or `creditGiftStampLot` and returns `{ handled: true, stamp_purchase: 'already_credited' }`.
- **payment-hardening.AC9.2 Success — fast path preserved:** When `hasStampCheckout` returns `true` (the cheap check), `applyStampCheckout` short-circuits to `'already_credited'` without entering the credit functions. This remains an optimization, not a correctness gate.
- **payment-hardening.AC9.3 Defensive:** A `checkout.completed` event that already has a credited `stamp_lots` row triggers `'already_credited'` end-to-end without raising 5xx.

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Migration 0015 — partial UNIQUE on `stamp_lots.autumn_checkout_id`

**Verifies:** payment-hardening.AC6.1, AC6.2, AC6.3

**Files:**
- Create: `netlify/database/migrations/0015_stamp_lots_checkout_unique/migration.sql`
- Create: `netlify/database/migrations/0015_stamp_lots_checkout_unique/down.sql`

**Implementation:**

`netlify/database/migrations/0015_stamp_lots_checkout_unique/migration.sql`:

```sql
-- 0015_stamp_lots_checkout_unique
-- Prevents double-credit on Autumn webhook retries. Without this, two
-- concurrent deliveries of the same checkout.completed event can both
-- pass the advisory hasStampCheckout() check and both credit the user.
--
-- The partial index applies only to purchase and gift_received lots that
-- carry an autumn_checkout_id. Grants (source='grant') have a NULL
-- autumn_checkout_id and are unaffected — migration_grant fixtures and
-- the signup grant remain insertable.
--
-- Postgres surfaces a 23505 (unique_violation) on the second concurrent
-- INSERT. The caller in netlify/lib/stamps.ts catches it and raises a
-- typed DuplicateStampCheckoutError, which applyStampCheckout maps to
-- the existing 'already_credited' webhook outcome.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stamp_lots_autumn_checkout_purchase
    ON stamp_lots (autumn_checkout_id)
    WHERE source IN ('purchase', 'gift_received')
        AND autumn_checkout_id IS NOT NULL;

COMMIT;
```

`netlify/database/migrations/0015_stamp_lots_checkout_unique/down.sql`:

```sql
BEGIN;

DROP INDEX IF EXISTS idx_stamp_lots_autumn_checkout_purchase;

COMMIT;
```

**Testing:** Migration verified by Task 2's integration tests, which depend on the index existing.

**Verification:**

Manually applied in dev:

```sh
# From the project root, against the dev DB:
psql "$DATABASE_URL" -f netlify/database/migrations/0015_stamp_lots_checkout_unique/migration.sql
psql "$DATABASE_URL" -c "\d+ stamp_lots" | grep idx_stamp_lots_autumn_checkout_purchase
```

Expected: the partial unique index appears in the index list.

Re-run idempotency:

```sh
psql "$DATABASE_URL" -f netlify/database/migrations/0015_stamp_lots_checkout_unique/migration.sql
```

Expected: no error (the `IF NOT EXISTS` makes it a no-op).

**Commit:** `feat(db): add partial unique index on stamp_lots.autumn_checkout_id (migration 0015)`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Surface 23505 from `creditStampLot` and `creditGiftStampLot`

**Verifies:** payment-hardening.AC7.1, AC7.2, AC7.3, AC8.1, AC8.2, AC8.3

**Files:**
- Modify: `netlify/lib/stamps.ts:269-289` (existing error classes block) — add `DuplicateStampCheckoutError`
- Modify: `netlify/lib/stamps.ts:506-574` (`creditStampLot`) — catch 23505 from lot INSERT
- Modify: `netlify/lib/stamps.ts:619-721` (`creditGiftStampLot`) — same
- Modify: `test/us017-gift-stamp-webhook.test.ts` — add concurrent + duplicate test cases (after Phase 1 un-skips it)
- Create: `test/us039-credit-stamp-lot-idempotent.test.ts` — unit + integration tests for the credit functions

**Implementation:**

Add the error class near the existing ones (`stamps.ts:269-289`):

```ts
export class DuplicateStampCheckoutError extends Error {
    constructor () {
        super('Stamp checkout already credited.')
        this.name = 'DuplicateStampCheckoutError'
    }
}
```

Update `creditStampLot` to catch 23505 on the lot INSERT. The catch must run BEFORE `await client.query('ROLLBACK')` decides whether to bubble or translate, so wrap only the INSERT:

```ts
export async function creditStampLot (
    options:CreditStampLotOptions
):Promise<CreditStampLotResult> {
    const db = getDatabase()
    const client = await db.pool.connect() as DatabaseClient

    try {
        await client.query('BEGIN')

        let lotResult:QueryResult<StampLotRow>

        try {
            lotResult = await client.query<StampLotRow>(`
                INSERT INTO stamp_lots (
                    user_id,
                    source,
                    original_count,
                    remaining_count,
                    price_paid_cents,
                    autumn_checkout_id,
                    gifted_by_user_id
                )
                VALUES ($1, $2, $3, $3, $4, $5, $6)
                RETURNING id
            `, [
                options.userId,
                options.source,
                options.count,
                options.priceCents ?? null,
                options.autumnCheckoutId,
                options.giftedByUserId
            ])
        } catch (err) {
            if (isUniqueViolation(err)) {
                await client.query('ROLLBACK').catch(() => {})
                throw new DuplicateStampCheckoutError()
            }
            throw err
        }

        const lotId = lotResult.rows[0].id

        // … existing balance + transaction inserts unchanged …

        await client.query('COMMIT')
        return { lotId, balanceAfter }
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
    } finally {
        client.release()
    }
}

function isUniqueViolation (err:unknown):boolean {
    // Duplication from shares.ts:317-322 is intentional for now — refactor into
    // netlify/lib/db-errors.ts in a follow-up after Phase 7 ships. Keeping local
    // minimizes phase coupling.
    return !!err
        && typeof err === 'object'
        && (err as { code?:string }).code === '23505'
}
```

Apply the same pattern to `creditGiftStampLot` (`:628-647` is the lot INSERT; wrap with the same try/catch and rethrow `DuplicateStampCheckoutError` on 23505 before any other queries run).

Mark the new `DuplicateStampCheckoutError` class with `export class`. The existing error classes are already individually exported — do NOT add a re-export block.

The `isUniqueViolation` helper is duplicated from `shares.ts:317-322`. Keep it local in `stamps.ts` for now (do not refactor into a shared module — out of scope for this phase).

**Testing:**

`test/us039-credit-stamp-lot-idempotent.test.ts` covers AC7.* and AC8.* with three scenarios per function (first call succeeds, duplicate raises, concurrent races resolve to exactly one credit):

- AC7.1 / AC8.1 — first call: mock `db.pool.connect`, simulate INSERT returning a lot id, balance update returning `{stamps_balance: count}`, transaction INSERT succeeding. Assert `{lotId, balanceAfter}` shape and that `client.query` was called with BEGIN, INSERT lot, UPDATE users, INSERT stamp_transactions, COMMIT, in that order.
- AC7.2 / AC8.2 — duplicate: mock the lot INSERT to throw `{ code: '23505' }`. Assert `creditStampLot(...)` rejects with `DuplicateStampCheckoutError`. Assert ROLLBACK was called and no subsequent queries ran.
- AC7.3 / AC8.3 — concurrent: integration-style test using two `creditStampLot` calls fired with `Promise.allSettled`. Mock one path to throw 23505, the other to succeed. Assert exactly one `'fulfilled'` and one `'rejected'` with `DuplicateStampCheckoutError`.

For Phase 1's `test/us017-gift-stamp-webhook.test.ts` (un-skipped), extend with one more case: webhook delivered twice for the same `checkout_id` — second call returns `{ handled: true, stamp_purchase: 'already_credited' }` and recipient balance unchanged.

**Verification:**
```sh
npx vitest run test/us039-credit-stamp-lot-idempotent.test.ts test/us017-gift-stamp-webhook.test.ts
```

**Commit:** `feat(stamps): credit functions raise DuplicateStampCheckoutError on 23505`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Webhook handler maps duplicates to `'already_credited'`

**Depends on:** Phase 1's metadata renames (handle, not email).

**Verifies:** payment-hardening.AC9.1, AC9.2, AC9.3

**Files:**
- Modify: `netlify/lib/billing.ts:423-487` (`applyStampCheckout`) — wrap the credit calls in a try/catch that maps `DuplicateStampCheckoutError` to `'already_credited'`
- Modify: `netlify/lib/billing.ts:1-21` — import `DuplicateStampCheckoutError`
- Modify: `test/us023-stamp-transactions-api.test.ts` or create new `test/us039-webhook-idempotent.test.ts` (whichever is simpler — prefer new file)

**Implementation:**

Imports at top of `billing.ts`:

```ts
import {
    createPendingGift,
    creditGiftStampLot,
    creditStampLot,
    DuplicateStampCheckoutError
} from './stamps.js'
```

Update `applyStampCheckout` so each credit call is wrapped:

```ts
async function applyStampCheckout (
    checkout:StampCheckoutEvent
):Promise<AutumnWebhookResult> {
    if (await hasStampCheckout(checkout.checkoutId)) {
        return { handled: true, stamp_purchase: 'already_credited' }
    }

    if (checkout.gift) {
        try {
            await creditGiftStampLot({
                senderUserId: checkout.gift.senderUserId,
                recipientUserId: checkout.gift.recipientUserId,
                count: checkout.pack.count,
                priceCents: checkout.pack.priceCents,
                autumnCheckoutId: checkout.checkoutId
            })
        } catch (err) {
            if (err instanceof DuplicateStampCheckoutError) {
                return {
                    handled: true,
                    stamp_purchase: 'already_credited'
                }
            }
            throw err
        }

        await sendStampGiftEmail({
            email: `${checkout.gift.recipientHandle}@bsky.social`,
            senderEmail: `${checkout.gift.senderHandle}@bsky.social`,
            count: checkout.pack.count
        })

        return { handled: true, stamp_purchase: 'gift_credited' }
    }

    if (checkout.pendingGift) {
        try {
            await createPendingGift({
                senderUserId: checkout.pendingGift.senderUserId,
                recipientEmail: checkout.pendingGift.recipientEmail,
                packId: checkout.pack.productId,
                count: checkout.pack.count,
                priceCents: checkout.pack.priceCents,
                autumnCheckoutId: checkout.checkoutId
            })
        } catch (err) {
            if (isUniqueViolation(err)) {
                return {
                    handled: true,
                    stamp_purchase: 'already_credited'
                }
            }
            throw err
        }

        await sendPendingGiftInviteEmail({
            email: checkout.pendingGift.recipientEmail,
            senderEmail: `${checkout.pendingGift.senderHandle}@bsky.social`,
            count: checkout.pack.count,
            signupUrl: getPendingGiftSignupUrl(checkout.checkoutId)
        })

        return { handled: true, stamp_purchase: 'pending_gift_created' }
    }

    try {
        await creditStampLot({
            userId: checkout.userId,
            source: 'purchase',
            count: checkout.pack.count,
            priceCents: checkout.pack.priceCents,
            autumnCheckoutId: checkout.checkoutId
        })
    } catch (err) {
        if (err instanceof DuplicateStampCheckoutError) {
            return { handled: true, stamp_purchase: 'already_credited' }
        }
        throw err
    }

    return { handled: true, stamp_purchase: 'credited' }
}
```

Add the local `isUniqueViolation` helper (or import from a shared spot if Phase 1 already moved it — leave local for now per scope).

**Testing:**

`test/us039-webhook-idempotent.test.ts` covers AC9.*:

- AC9.1: Mock `creditStampLot` to throw `DuplicateStampCheckoutError`. Call `applyStampCheckout({ /* purchase event */ })`. Assert returns `{ handled: true, stamp_purchase: 'already_credited' }`.
- AC9.2: Mock `hasStampCheckout` to return `true`. Spy on `creditStampLot`. Call `applyStampCheckout(...)`. Assert returns `'already_credited'` AND `creditStampLot` was NOT called.
- AC9.3: End-to-end style — mock the DB to record the same lot once (first call), then return 23505 (second call). Send the same webhook event twice. Assert second call returns `'already_credited'`, recipient balance unchanged, no extra transactions.

**Verification:**
```sh
npx vitest run test/us039-webhook-idempotent.test.ts test/us039-credit-stamp-lot-idempotent.test.ts
```

**Commit:** `feat(webhook): map DuplicateStampCheckoutError to already_credited outcome`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Full suite verification

**Verifies:** Phase 2 regression-free for all previously-passing tests.

**Files:** none — verification only.

**Verification:**
```sh
npm run lint && npx vitest run
```
Expected: lint passes; all tests pass; new tests cover the AC7/AC8/AC9 paths.

```sh
psql "$DATABASE_URL" -c "\d+ stamp_lots" | grep idx_stamp_lots_autumn_checkout_purchase
```
Expected: index present.

**Commit:** none (verification only).
<!-- END_TASK_4 -->

---

## Phase 2 Done When

- Migration 0015 is committed and the partial unique index exists in dev/staging.
- `creditStampLot` and `creditGiftStampLot` raise `DuplicateStampCheckoutError` on a retried Autumn checkout.
- `applyStampCheckout` returns `{ handled: true, stamp_purchase: 'already_credited' }` for retries, never 5xx.
- New tests cover first-call success, duplicate, and concurrent-race scenarios.
- `npm run lint && npx vitest run` is green.

## Operator notes

- We intentionally do **not** add UNIQUE on `stamp_transactions(reference_id, reason)` — the append-only trigger on `stamp_transactions` (migration 0007) makes `ON CONFLICT DO UPDATE` semantically awkward, and the lot-level UNIQUE in this migration is sufficient because every credit funnels through `creditStampLot`/`creditGiftStampLot`.
- After deploy, run `verify-stamp-invariants` once manually to confirm no pre-existing duplicate lots (should return zero drift).
- Existing duplicate purchases — none expected in production today since gift checkout is broken (Phase 1). Phase 2's migration will fail to create the unique index if any duplicates exist; surface that as a manual cleanup task BEFORE applying the migration in staging/prod. Pre-check:
  ```sql
  SELECT autumn_checkout_id, COUNT(*)
  FROM stamp_lots
  WHERE source IN ('purchase', 'gift_received')
    AND autumn_checkout_id IS NOT NULL
  GROUP BY autumn_checkout_id
  HAVING COUNT(*) > 1;
  ```
  Expected: zero rows.
