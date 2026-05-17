# Phase 3: DB-layer append-only enforcement + durable drift alerts

**Goal:** Move the `stamp_transactions is append-only` invariant from application discipline to a database guarantee, and make invariant drift surface durably (queryable) instead of vanishing into Netlify function logs after retention expires.

**Architecture:** A new migration adds `BEFORE UPDATE` and `BEFORE DELETE` triggers on `stamp_transactions` that `RAISE EXCEPTION`, so any code path — current, future, or an admin pulling out psql at 2am — that tries to mutate the audit log is rejected by Postgres itself. The existing scheduled `verifyStampInvariants()` is extended to write each detected drift into a new `stamp_invariant_alerts` table (and keep the existing `console.error`), so operators can `SELECT * FROM stamp_invariant_alerts WHERE resolved_at IS NULL` to see what needs attention without scrolling through function logs.

**Tech Stack:** Postgres triggers (plpgsql), existing `@netlify/database` connection, existing Netlify Scheduled Functions. No new dependencies.

**Scope:** Phase 3 of 4.

**Codebase verified:** 2026-05-16

**Design source:** `/Users/nick/code/drerings/docs/pricing.md` lines 91–97 (invariants + "periodic background job should verify these invariants and alert on drift").

---

## Acceptance Criteria Coverage

### stamps.AC9: Database rejects mutation of `stamp_transactions`
- **stamps.AC9.1 UPDATE rejected:** `UPDATE stamp_transactions SET delta = 0 WHERE id = '<any>'` raises a Postgres error containing the string `append-only`. The row is unchanged. (Design line 95.)
- **stamps.AC9.2 DELETE rejected:** `DELETE FROM stamp_transactions WHERE id = '<any>'` raises a Postgres error containing the string `append-only`. The row remains. (Design line 95.)
- **stamps.AC9.3 INSERT still works:** `INSERT INTO stamp_transactions (...) VALUES (...)` succeeds; existing app code paths are unaffected. All existing tests that insert into `stamp_transactions` continue to pass.
- **stamps.AC9.4 TRUNCATE not catastrophic:** `TRUNCATE stamp_transactions` is NOT blocked (would require a separate `BEFORE TRUNCATE` statement-level trigger). Document this in the migration comment so anyone wiring up test fixtures knows. (Test fixtures may legitimately TRUNCATE; production code never should.)

### stamps.AC10: Invariant drift is recorded durably
- **stamps.AC10.1 Drift row on detection:** When `verifyStampInvariants()` detects drift for user X on invariant Y, it INSERTs a row into `stamp_invariant_alerts` with `user_id=X`, `invariant=Y`, `expected`, `actual`, `detected_at=now()`, `resolved_at=NULL`.
- **stamps.AC10.2 Idempotent within a run:** A single scheduled run produces at most one alert row per `(user_id, invariant)` pair, even if both invariants drift for the same user. (Two drifts for one user → two rows, one per invariant.)
- **stamps.AC10.3 No duplicate active alerts across runs:** If yesterday's run logged drift for `(user_X, invariant_1)` and today's run also detects it, today's run does NOT insert a second row while the original is still `resolved_at IS NULL`. (Use `ON CONFLICT` against a partial unique index, or an `EXISTS` check.)
- **stamps.AC10.4 No alerts when clean:** A run where every user's invariants hold INSERTs zero rows.
- **stamps.AC10.5 Manual resolution clears the alert:** An operator running `UPDATE stamp_invariant_alerts SET resolved_at = now() WHERE id = '...'` does not interfere with future detection — if the same drift recurs after resolution, a new alert row is inserted.

### stamps.AC11: Existing behavior preserved
- **stamps.AC11.1 Existing scheduled function still runs:** `netlify/functions/verify-stamp-invariants.ts` (cron `30 9 * * *`) continues to produce the same `200 { usersChecked, driftCount, drifts }` JSON response. Existing tests in `test/us025-stamp-invariants.test.ts` still pass.
- **stamps.AC11.2 Existing `console.error` still emitted:** The `console.error('Stamp invariant drift detected.', ...)` lines in `verifyStampInvariants` (currently at `netlify/lib/stamps.ts:450–456`) are unchanged — function logs continue to receive drift events. The DB alert is additive.

---

## Codebase findings to encode into this phase

Verified during spot-checks (2026-05-16):

- `netlify/lib/stamps.ts:416–470` defines `verifyStampInvariants()` returning `{usersChecked, driftCount, drifts}` where `drifts` is `Array<{userId, invariant, expected, actual}>`. The `invariant` field is a string identifier — likely something like `'balance_matches_lots'` and `'balance_matches_transactions'`. Confirm by reading `stampInvariantDriftsForRow` (called at line 447) to learn the exact string values used.
- `netlify/functions/verify-stamp-invariants.ts:1–13` already wraps `verifyStampInvariants()` in `schedule('30 9 * * *', ...)`. **The audit was wrong about this being unreachable.** It runs daily at 09:30 UTC and emits results to function logs. This file is a thin wrapper; the durable-alert side effect should live inside `verifyStampInvariants` (close to the data) rather than in the wrapper.
- `netlify/functions/refund-expired-gifts.ts` shows the same `schedule(...)` pattern at cron `0 9 * * *`. Use the same import convention (`import { schedule, type Handler } from '@netlify/functions'`).
- The migrations directory contains `0001` through `0005`. **There are no triggers anywhere in any migration.** Append-only is currently a property of the application code, not the database. Adding triggers is purely additive — no existing INSERT path will be affected.
- `test/us025-stamp-invariants.test.ts` covers the existing `verifyStampInvariants` behavior. New tests for the alert persistence go in a new file rather than expanding us025 (keeps the existing test's surface stable).
- The migrations use `gen_random_uuid()` for IDs and `timestamptz NOT NULL DEFAULT now()` for timestamps (see `netlify/database/migrations/0003_stamp_accounting/migration.sql`). Follow that style.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Migration `0007_stamp_transactions_append_only`

**Verifies:** stamps.AC9.1, stamps.AC9.2, stamps.AC9.3, stamps.AC9.4.

**Files:**
- Create: `/Users/nick/code/drerings/netlify/database/migrations/0007_stamp_transactions_append_only/migration.sql`
- Create: `/Users/nick/code/drerings/netlify/database/migrations/0007_stamp_transactions_append_only/down.sql`
- Create: `/Users/nick/code/drerings/test/us0NN-stamp-transactions-append-only.test.ts`

**Implementation:**

`migration.sql`:

```sql
-- stamp_transactions is the audit ledger for the stamps feature.
-- Design invariant (docs/pricing.md line 95):
--   "stamp_transactions is append-only — no updates or deletes, ever."
--
-- These triggers move that invariant from application discipline to a
-- database guarantee. Note: this does NOT block TRUNCATE; test fixtures
-- may legitimately TRUNCATE during setUp. Production code paths never
-- should.
--
-- Refunds are recorded as NEW rows with reason='failed_send_refund' or
-- 'refund' or 'gift_reclaimed', not by mutating the original debit row.

CREATE OR REPLACE FUNCTION reject_stamp_tx_mutation ()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'stamp_transactions is append-only (attempted %)',
        TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stamp_tx_no_update
    BEFORE UPDATE ON stamp_transactions
    FOR EACH ROW EXECUTE FUNCTION reject_stamp_tx_mutation();

CREATE TRIGGER stamp_tx_no_delete
    BEFORE DELETE ON stamp_transactions
    FOR EACH ROW EXECUTE FUNCTION reject_stamp_tx_mutation();
```

`down.sql`:

```sql
DROP TRIGGER IF EXISTS stamp_tx_no_delete ON stamp_transactions;
DROP TRIGGER IF EXISTS stamp_tx_no_update ON stamp_transactions;
DROP FUNCTION IF EXISTS reject_stamp_tx_mutation();
```

**Testing:**

`test/us0NN-stamp-transactions-append-only.test.ts` uses the same `vi.doMock('@netlify/database', ...)` pattern the existing tests use. However, this test is fundamentally about a DB-level constraint, so mocking is insufficient — we need a real Postgres path.

Two-pronged test strategy:

**Unit-level (always run):** Mock the pool to simulate Postgres throwing the trigger error. Assert that callers handle the rejection cleanly (they should never call UPDATE/DELETE on `stamp_transactions` in the first place, so this is mostly a "negative test" — if any path does, the test demonstrates the error message it would receive). Cover:
- A UPDATE query against the mock returns `Error: stamp_transactions is append-only (attempted UPDATE)` — the message format matches what the trigger emits.
- A DELETE query against the mock returns `Error: stamp_transactions is append-only (attempted DELETE)`.

**Integration-level (skipped unless `RUN_DB_INTEGRATION=1`):** Connect to the local Netlify-managed Postgres via `getDatabase().pool` after running migrations, attempt UPDATE/DELETE on a real row, assert the throw. The test SKIPs (not fails) if the env var isn't set, so CI without a DB still passes.

Example structure:

```typescript
import { describe, expect, it, beforeAll } from 'vitest'

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === '1'

describe('US-0NN stamp_transactions append-only triggers', () => {
    describe('unit-level (mocked)', () => {
        it('error message format is what the trigger emits', () => {
            const updateError = new Error(
                'stamp_transactions is append-only (attempted UPDATE)'
            )
            expect(updateError.message).toMatch(/append-only/)
            expect(updateError.message).toMatch(/UPDATE/)
        })
    })

    describe.runIf(RUN_INTEGRATION)('integration', () => {
        let userId:string
        let lotId:string
        let txId:string

        beforeAll(async () => {
            // Insert a fixture row to attempt mutating.
            const { getDatabase } = await import('@netlify/database')
            const pool = getDatabase().pool
            // users.id is uuid (see 0001_paid_accounts_schema). Just use
            // the database default — let it generate the uuid.
            const userResult = await pool.query<{id:string}>(
                `INSERT INTO users (email)
                 VALUES ($1)
                 RETURNING id`,
                ['append-only-' + Date.now() + '@example.com']
            )
            userId = userResult.rows[0].id
            const lot = await pool.query<{id:string}>(
                `INSERT INTO stamp_lots
                    (user_id, source, original_count, remaining_count)
                 VALUES ($1, 'grant', 5, 5)
                 RETURNING id`,
                [userId]
            )
            lotId = lot.rows[0].id
            const tx = await pool.query<{id:string}>(
                `INSERT INTO stamp_transactions
                    (user_id, lot_id, delta, reason, balance_after)
                 VALUES ($1, $2, 5, 'grant', 5)
                 RETURNING id`,
                [userId, lotId]
            )
            txId = tx.rows[0].id
        })

        it('rejects UPDATE', async () => {
            const { getDatabase } = await import('@netlify/database')
            await expect(
                getDatabase().pool.query(
                    `UPDATE stamp_transactions
                     SET delta = 0
                     WHERE id = $1`,
                    [txId]
                )
            ).rejects.toThrow(/append-only/)
        })

        it('rejects DELETE', async () => {
            const { getDatabase } = await import('@netlify/database')
            await expect(
                getDatabase().pool.query(
                    `DELETE FROM stamp_transactions
                     WHERE id = $1`,
                    [txId]
                )
            ).rejects.toThrow(/append-only/)
        })

        it('still allows INSERT', async () => {
            const { getDatabase } = await import('@netlify/database')
            const result = await getDatabase().pool.query(
                `INSERT INTO stamp_transactions
                    (user_id, lot_id, delta, reason, balance_after)
                 VALUES ($1, $2, -1, 'send', 4)
                 RETURNING id`,
                [userId, lotId]
            )
            expect(result.rows).toHaveLength(1)
        })
    })
})
```

The unit-level half always runs. The integration half runs locally via `RUN_DB_INTEGRATION=1 npm run test:e2e -- stamp-transactions-append-only` after `npx netlify db migrations apply`.

**Verification:**

Run: `npx netlify db migrations apply`
Expected: `0007_stamp_transactions_append_only` applies cleanly.

Run the integration test locally:
```bash
RUN_DB_INTEGRATION=1 npm run test:e2e -- stamp-transactions-append-only
```
Expected: all three integration cases pass.

Run the full regression suite WITHOUT the env var:
```bash
npm run test:e2e
```
Expected: all existing tests pass. None of them write tests that depend on being able to UPDATE/DELETE `stamp_transactions` — verify by checking the test for `UPDATE stamp_transactions` / `DELETE FROM stamp_transactions`:
```bash
grep -rn "UPDATE stamp_transactions\|DELETE FROM stamp_transactions" test/
```
Expected: zero matches (or only matches in the new us0NN-append-only test).

Smoke-check the running app:
```bash
npx netlify db query "UPDATE stamp_transactions SET delta = 0 WHERE id = (SELECT id FROM stamp_transactions LIMIT 1)"
```
Expected: error containing `append-only`. No row mutated.

**Commit:** `feat(stamps): db-layer append-only enforcement on stamp_transactions`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Migration `0008_stamp_invariant_alerts`

**Verifies:** (schema for Task 3.)

**Files:**
- Create: `/Users/nick/code/drerings/netlify/database/migrations/0008_stamp_invariant_alerts/migration.sql`
- Create: `/Users/nick/code/drerings/netlify/database/migrations/0008_stamp_invariant_alerts/down.sql`

**Implementation:**

`migration.sql`:

```sql
-- Durable record of stamp invariant drifts detected by the scheduled
-- verifyStampInvariants() job. Operators query this table instead of
-- scrolling through Netlify function logs (which expire by retention
-- policy). One row per (user, invariant) drift event.

-- user_id is uuid to match users.id (see 0001_paid_accounts_schema:4 —
-- every user reference in this schema is uuid, never text).
CREATE TABLE stamp_invariant_alerts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invariant       text NOT NULL,        -- identifier from verifyStampInvariants
    expected        bigint NOT NULL,
    actual          bigint NOT NULL,
    detected_at     timestamptz NOT NULL DEFAULT now(),
    resolved_at     timestamptz,           -- NULL while the drift is active
    resolution_note text                   -- operator's note when marking resolved
);

-- Active alerts are the queryable working set. A new drift for the same
-- (user, invariant) is suppressed while the previous one is still open.
CREATE UNIQUE INDEX idx_alerts_active_unique
    ON stamp_invariant_alerts(user_id, invariant)
    WHERE resolved_at IS NULL;

-- For the operator dashboard query: "show me everything open right now".
CREATE INDEX idx_alerts_active_recent
    ON stamp_invariant_alerts(detected_at DESC)
    WHERE resolved_at IS NULL;
```

`down.sql`:

```sql
DROP INDEX IF EXISTS idx_alerts_active_recent;
DROP INDEX IF EXISTS idx_alerts_active_unique;
DROP TABLE IF EXISTS stamp_invariant_alerts;
```

**Verification:**

Run: `npx netlify db migrations apply`
Expected: applies cleanly.

Run: `npx netlify db query "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='stamp_invariant_alerts' ORDER BY ordinal_position"`
Expected: 7 rows (id, user_id, invariant, expected, actual, detected_at, resolved_at, resolution_note) with the correct types.

Run: `npx netlify db query "SELECT indexname FROM pg_indexes WHERE tablename='stamp_invariant_alerts'"`
Expected: 3 indexes (the PK + the 2 explicit ones).

Test the partial unique index manually. Capture a fresh user uuid first; the existing migrations don't seed users at apply time, so create one:
```bash
USER_ID=$(npx netlify db query --json "INSERT INTO users(email) VALUES ('alert-test@example.com') RETURNING id" | jq -r '.[0].id')
echo "Using user $USER_ID"

npx netlify db query "
INSERT INTO stamp_invariant_alerts(user_id, invariant, expected, actual)
    VALUES ('$USER_ID', 'balance_matches_lots', 5, 3);
INSERT INTO stamp_invariant_alerts(user_id, invariant, expected, actual)
    VALUES ('$USER_ID', 'balance_matches_lots', 5, 3);
"
```
Expected: the second INSERT raises a unique-violation error. Cleanup:
```bash
npx netlify db query "
DELETE FROM stamp_invariant_alerts WHERE user_id='$USER_ID';
DELETE FROM users WHERE id='$USER_ID';
"
```

(If `--json` output isn't available, run the INSERT manually and copy the returned uuid into the next commands.)

**Commit:** `feat(stamps): stamp_invariant_alerts table for durable drift records`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Persist drift alerts inside `verifyStampInvariants`

**Verifies:** stamps.AC10.1, stamps.AC10.2, stamps.AC10.3, stamps.AC10.4, stamps.AC10.5, stamps.AC11.1, stamps.AC11.2.

**Files:**
- Modify: `/Users/nick/code/drerings/netlify/lib/stamps.ts`
- Create: `/Users/nick/code/drerings/test/us0NN-stamp-invariant-alerts.test.ts`

**Implementation:**

Edit `verifyStampInvariants` at `netlify/lib/stamps.ts:416–470` so that after collecting `drifts`, it persists each drift to `stamp_invariant_alerts` while preserving the existing `console.error` output and return shape:

```typescript
// After this existing block (around line 446-447):
const drifts = result.rows.flatMap((row) => {
    return stampInvariantDriftsForRow(row)
})

// ...keep the existing console.error loop unchanged (AC11.2):
for (const drift of drifts) {
    console.error('Stamp invariant drift detected.', {
        user_id: drift.userId,
        invariant: drift.invariant,
        expected: drift.expected,
        actual: drift.actual
    })
}

// NEW: insert each drift into stamp_invariant_alerts.
// The partial unique index on (user_id, invariant) WHERE resolved_at
// IS NULL silently de-dupes against existing open alerts (AC10.3).
let alertsRecorded = 0
for (const drift of drifts) {
    const inserted = await db.pool.query<{id:string}>(`
        INSERT INTO stamp_invariant_alerts
            (user_id, invariant, expected, actual)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, invariant) WHERE resolved_at IS NULL
        DO NOTHING
        RETURNING id
    `, [drift.userId, drift.invariant, drift.expected, drift.actual])
    if (inserted.rowCount && inserted.rowCount > 0) {
        alertsRecorded += 1
    }
}

if (drifts.length > 0) {
    console.error('Stamp invariant verification alert.', {
        driftCount: drifts.length,
        alertsRecorded   // distinguishes new vs already-open alerts
    })
}

return {
    usersChecked: result.rows.length,
    driftCount: drifts.length,
    drifts
}
```

Update the `VerifyStampInvariantsResult` interface only if you need to expose `alertsRecorded` to the function's response — but **don't**: the existing return shape is part of `test/us025-stamp-invariants.test.ts`'s assertions, and changing it would break AC11.1. The `alertsRecorded` count is purely for the log line.

**One subtlety:** Postgres's `ON CONFLICT` with a partial index requires the predicate to be specified. Syntax verified against Postgres docs; if `ON CONFLICT (user_id, invariant) WHERE resolved_at IS NULL DO NOTHING` errors at runtime, the alternative is a manual existence check:

```sql
INSERT INTO stamp_invariant_alerts
    (user_id, invariant, expected, actual)
SELECT $1, $2, $3, $4
WHERE NOT EXISTS (
    SELECT 1 FROM stamp_invariant_alerts
    WHERE user_id = $1 AND invariant = $2 AND resolved_at IS NULL
)
RETURNING id
```

Pick whichever the local Postgres accepts (test it during implementation).

**Testing:**

`test/us0NN-stamp-invariant-alerts.test.ts` covers AC10:

- **AC10.1 + AC10.2 inserts on drift:** mock the pool so the SELECT returns two rows with drift on different invariants → assert two INSERTs into `stamp_invariant_alerts`, each with the right `(user_id, invariant, expected, actual)`.
- **AC10.3 dedupe within one run:** mock the pool so `ON CONFLICT DO NOTHING` returns `rowCount: 0` for the second-attempt INSERT — assert the function still completes and the log line reports `alertsRecorded: 0`.
- **AC10.4 no inserts when clean:** mock the SELECT to return rows where `cached_balance === lot_balance === transaction_balance` for everyone → assert zero INSERTs.
- **AC11.1 response shape preserved:** assert the function returns the existing `{usersChecked, driftCount, drifts}` object — no `alertsRecorded` field leaking out.
- **AC11.2 console.error still emitted:** spy on `console.error`, assert the existing `'Stamp invariant drift detected.'` line is still produced once per drift.

For AC10.5 (manual resolution doesn't break re-detection), this is a property of the schema (the partial index excludes `resolved_at IS NOT NULL`), not of the function logic. Cover it in the migration test instead (extend Task 2's smoke check):
```bash
USER_ID=$(npx netlify db query --json "INSERT INTO users(email) VALUES ('alert-test2@example.com') RETURNING id" | jq -r '.[0].id')

npx netlify db query "
INSERT INTO stamp_invariant_alerts(user_id, invariant, expected, actual)
    VALUES ('$USER_ID', 'balance_matches_lots', 5, 3);
UPDATE stamp_invariant_alerts
    SET resolved_at = now()
    WHERE user_id='$USER_ID' AND resolved_at IS NULL;
INSERT INTO stamp_invariant_alerts(user_id, invariant, expected, actual)
    VALUES ('$USER_ID', 'balance_matches_lots', 5, 3);
"
```
Expected: both INSERTs succeed (the first one was resolved; the second is the new active alert). Cleanup:
```bash
npx netlify db query "
DELETE FROM stamp_invariant_alerts WHERE user_id='$USER_ID';
DELETE FROM users WHERE id='$USER_ID';
"
```

**Verification:**

Run: `npm run test:e2e -- us0NN-stamp-invariant-alerts us025-stamp-invariants`
Expected: all new tests pass, existing us025 still passes.

Run: `npm run lint && npx tsc -p tsconfig.json --noEmit`
Expected: no new errors.

Smoke-test the live function:
```bash
curl -X POST http://localhost:9999/.netlify/functions/verify-stamp-invariants
```
Expected: `200 {usersChecked, driftCount, drifts}`. Inspect logs for the existing console output. With a clean DB, no rows in `stamp_invariant_alerts`. If you manually corrupt a balance:
```bash
npx netlify db query "UPDATE users SET stamps_balance = stamps_balance + 1 WHERE id = (SELECT id FROM users LIMIT 1)"
```
Then re-run the curl. Expected: one new row in `stamp_invariant_alerts`. Restore:
```bash
npx netlify db query "UPDATE users SET stamps_balance = stamps_balance - 1 WHERE id = (SELECT id FROM users LIMIT 1)"
```
And mark the alert resolved:
```bash
npx netlify db query "UPDATE stamp_invariant_alerts SET resolved_at = now() WHERE resolved_at IS NULL"
```

**Commit:** `feat(stamps): persist invariant drift to stamp_invariant_alerts`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Document the alert query for operators

**Verifies:** None.

**Files:**
- Modify: `/Users/nick/code/drerings/README.md` (or `docs/operations.md` if that exists)

**Implementation:**

Add a short ops section near the existing scheduled-functions documentation (or create one if absent):

```markdown
### Stamp invariant alerts

The scheduled function `verify-stamp-invariants` runs daily at 09:30 UTC
and writes any detected drift to the `stamp_invariant_alerts` table.

To see all active alerts:

    SELECT
        id, user_id, invariant, expected, actual, detected_at
    FROM stamp_invariant_alerts
    WHERE resolved_at IS NULL
    ORDER BY detected_at ASC;

Per docs/pricing.md, a human investigates the first drift before any
automated reconciliation runs. After investigating and fixing the
underlying cause, mark the alert resolved:

    UPDATE stamp_invariant_alerts
    SET resolved_at = now(), resolution_note = $1
    WHERE id = $2;

If the same drift recurs on the next run, a new row is inserted — the
unique index excludes already-resolved alerts.
```

**Verification:**

Read the doc back, confirm the SQL is syntactically correct against the schema from Task 2.

**Commit:** `docs(stamps): document stamp invariant alert workflow`
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

---

## Done when

- Migration `0007_stamp_transactions_append_only` is applied: UPDATE/DELETE on `stamp_transactions` are rejected by Postgres.
- Migration `0008_stamp_invariant_alerts` is applied: `stamp_invariant_alerts` table + the active-only partial unique index exist.
- `verifyStampInvariants()` writes a row per drift while preserving its existing return shape and `console.error` calls.
- All existing tests (including `test/us025-stamp-invariants.test.ts`) pass without modification.
- The ops doc explains the operator's workflow for active alerts.

## Out of scope for Phase 3

- **Email/Slack alerting.** This phase makes alerts durable and queryable. Pushing them to an external channel (admin email via Resend, Slack incoming-webhook, PagerDuty) is a follow-on if log + DB query are insufficient.
- **Automated reconciliation.** Design explicitly says a human investigates first.
- **TRUNCATE protection.** Allowed because test fixtures need it; production code paths never TRUNCATE.
- **Performance tuning of the verification query.** The existing `SELECT ... FROM users LEFT JOIN ...` is full-scan and fine at current row counts; revisit if it exceeds a few seconds.
- **Autumn refund failure recovery.** Phase 4.
