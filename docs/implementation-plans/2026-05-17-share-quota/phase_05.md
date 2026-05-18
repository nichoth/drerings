# Phase 5: Share Endpoints and Domain Lib Implementation Plan

**Goal:** Server-side enforcement of the monthly free share + stamp
overage rule. Two new endpoints (`precheck` and `confirm`), a new
domain lib (`netlify/lib/shares.ts`), and a parameterization of
`debitStamp` to accept `reason: 'share'`.

**Architecture:** Mirrors the postcard send flow. `recordShare`
performs a single Postgres transaction with `SELECT ... FOR UPDATE`
on the user row to serialize concurrent confirms. The
`precheck`/`confirm` pair shares an `idempotency_key` so retries are
safe.

**Tech Stack:** TypeScript, Postgres, Netlify Functions. Tests use
the project's vitest + `vi.doMock('@netlify/database')` pattern
(see `test/us003-debit-stamp.test.ts` for the canonical example).

**Scope:** 5 of 8 phases. Depends on Phase 1 (DB schema), Phase 4
(authed sessions).

**Codebase verified:** 2026-05-17

---

## Codebase Investigation Findings

- **`DebitStampOptions`** in `netlify/lib/stamps.ts` lines 81–84 is
  `{ userId, referenceId? }`. `debitStamp` hardcodes the
  `stamp_transactions.reason` insert to `'send'`. Phase 5 extends the
  options with `reason?:'send'|'share'` (default `'send'`).
- **`findOrCreateQueuedPostcard`** in `netlify/lib/postcards.ts`
  returns `{ postcard, reused }`. The pattern for `recordShare` is
  similar but the lookup is on `(user_id, idempotency_key)`.
- **Handler pattern** from `postcards/send.ts:18–27`:
  - `if (event.httpMethod !== 'POST') return json(405, ...)`
  - `const session = await getSession(event)`
  - `if (!session) return json(401, { error: 'Please sign in.' })`
  - `const body = parseJsonBody(event)` then validate
- **Drawing ownership check**: `postStore.userOwnsDrawing(userId,
  drawingId)` returns `boolean`. The share precheck/confirm must use
  this to enforce "share something you own."
- **Tests use vitest with `vi.doMock('@netlify/database')`** — see
  `test/us003-debit-stamp.test.ts:1–95` for the canonical mocking
  setup with `createDbMock`. Tests for the new shares module will
  follow this exact pattern.
- The test runner is `npm test` (esbuild bundle of `test/index.ts`
  piped through tapout). The vitest-style tests in `us*.test.ts`
  files run via `npm run test:e2e` (vitest). Both are part of CI.

---

## External Dependency Research Findings

- **IANA timezone validation**: `Intl.DateTimeFormat(timezone)` throws
  a `RangeError` if the timezone is invalid. Use this as the
  validator:
  ```ts
  function isValidIanaTimezone (tz:string):boolean {
      try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz })
          return true
      } catch {
          return false
      }
  }
  ```
- **Month key derivation**: `Intl.DateTimeFormat(undefined, {
  timeZone, year:'numeric', month:'2-digit' }).formatToParts(date)`
  yields a parts array; join `year` and `month` with `-`.
- **`SELECT ... FOR UPDATE`** on Postgres acquires a row-level
  exclusive lock until commit/rollback. Two concurrent transactions
  trying to FOR UPDATE the same `users` row will serialize.

---

## Acceptance Criteria Coverage

### share-quota.AC3
- **share-quota.AC3.3 Failure:** `POST /api/shares/precheck` without
  a valid session returns 401.
- **share-quota.AC3.4 Failure:** `POST /api/shares/confirm` without
  a valid session returns 401.

(AC3.1, AC3.2, AC3.5, AC3.6, AC3.7 require client wiring — see Phase 6.
Server endpoints in this phase produce the response shapes the client
consumes.)

### share-quota.AC4: Quota accounting is correct
- **share-quota.AC4.1 Success:** First confirmed share of a user's
  calendar month writes a `share_events` row with `was_free=true` and
  no `stamp_transactions` row.
- **share-quota.AC4.2 Success:** Subsequent confirmed share in the
  same month writes a `share_events` row with `was_free=false` AND a
  `stamp_transactions` row with `reason='share'`, `delta=-1`, and
  `reference_id = share_events.id`.
- **share-quota.AC4.3 Success:** A share in a new calendar month is
  free again, even if the previous month's free was already used.
- **share-quota.AC4.4 Success:** Month boundaries are computed in the
  IANA timezone the client supplies — same instant in different TZs
  can yield different `month_key` values.
- **share-quota.AC4.5 Failure:** Two concurrent confirms for the same
  user with no prior share that month: at most one is recorded as
  `was_free=true`; the other either records as paid (if stamps
  available) or returns `blocked`.
- **share-quota.AC4.6 Failure:** A `confirm` request with an
  `idempotency_key` that was already used for a different `drawing_id`
  returns 409.

### share-quota.AC5: Blocked path when out of free + stamps
- **share-quota.AC5.1 Success:** User has 0 stamps and has used their
  free share this month; precheck returns
  `{type:'blocked', reason:'no_free_no_stamps'}`; confirm also returns
  `blocked`.
- **share-quota.AC5.2 Success:** Client renders the no-stamps message.
  *(Server delivers the blocked response shape; client renders in
  Phase 6.)*

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Extend `debitStamp` with `reason` and external-client support

**Verifies:** share-quota.AC4.2 (substrate — recorded reason field).
Also enables AC4.1/AC4.2/AC4.5 by letting `recordShare` keep both the
share_events INSERT and the stamp debit inside ONE Postgres transaction
(the design's "Share-confirm transaction" spec).

**Files:**
- Modify: `/Users/nick/code/drerings/netlify/lib/stamps.ts`

**Step 1: Extend `DebitStampOptions`**

In `netlify/lib/stamps.ts` lines 81–84:

```ts
import type { PoolClient } from 'pg'

export interface DebitStampOptions {
    userId:string;
    referenceId?:string;
    reason?:'send'|'share';
    /**
     * Optional caller-supplied Postgres client. When provided,
     * `debitStamp` runs INSIDE the caller's existing transaction:
     * it does NOT issue BEGIN/COMMIT/ROLLBACK and does NOT release
     * the client. The caller owns the transaction lifecycle.
     *
     * When omitted (the existing default for postcards), `debitStamp`
     * acquires its own client and manages its own transaction.
     */
    client?:PoolClient;
}
```

(If the project's Postgres types come from `@netlify/database` rather
than `pg`, import the matching type — read the existing `connect()`
return type to confirm. The shape is the same: an object with
`.query()` and `.release()`.)

**Step 2: Make `debitStamp` use the supplied client when provided**

Find the function body. Extract the client acquisition into a branch:

```ts
export async function debitStamp (
    options:DebitStampOptions
):Promise<DebitStampResult> {
    if (options.client) {
        // Caller owns the transaction. Do not BEGIN/COMMIT/release.
        return debitStampOnClient(options.client, options)
    }

    const db = getDatabase()
    const client = await db.pool.connect()
    try {
        await client.query('BEGIN')
        const result = await debitStampOnClient(client, options)
        await client.query('COMMIT')
        return result
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
    } finally {
        client.release()
    }
}
```

Move the existing body of `debitStamp` (lot selection, UPDATE, INSERT
INTO stamp_transactions) into a private helper:

```ts
async function debitStampOnClient (
    client:PoolClient,
    options:DebitStampOptions
):Promise<DebitStampResult> {
    // ... existing lot-selection + UPDATE stamp_lots +
    //     UPDATE users + INSERT stamp_transactions logic ...
}
```

The reason argument is threaded through the INSERT (Step 3 below). Do
NOT change the SQL itself — only relocate it.

**Step 3: Thread `reason` through the helper**

Inside `debitStampOnClient`, locate the existing
`INSERT INTO stamp_transactions` (approx line 770 in the original
file). The current SQL hardcodes `'send'`. Change to:

```ts
const reason = options.reason ?? 'send'
// ...
await client.query(`
    INSERT INTO stamp_transactions (
        user_id, lot_id, reason, delta, reference_id
    )
    VALUES ($1, $2, $3, -1, $4)
`, [options.userId, lotId, reason, options.referenceId ?? null])
```

(Adjust to match the actual SQL — read the actual lines around 770
and adapt.)

**Step 4: Update `StampTransactionReason` type (if it exists)**

Find any TypeScript type declaring valid `reason` values (investigator
noted lines 3–12). Add `'share'`:

```ts
export type StampTransactionReason =
    | 'purchase'
    | 'grant'
    | 'migration_grant'
    | 'send'
    | 'refund'
    | 'gift_sent'
    | 'gift_received'
    | 'failed_send_refund'
    | 'share'
```

**Step 5: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

Expected: zero errors. Existing callers of `debitStamp` pass no
`reason` and default to `'send'` — unchanged behavior.

**Step 6: Run existing tests for `debitStamp`**

```bash
cd /Users/nick/code/drerings
npx vitest run test/us003-debit-stamp.test.ts
```

Expected: tests still pass — the default-`'send'` path is unchanged.

**Step 7: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/lib/stamps.ts
git commit -m "feat(stamps): debitStamp accepts optional reason='send'|'share'"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tests for the extended `debitStamp` reason

**Verifies:** share-quota.AC4.2

**Files:**
- Modify: `/Users/nick/code/drerings/test/us003-debit-stamp.test.ts`
  (or create a new sibling file `test/us003-debit-stamp-share-reason.test.ts`)

**Step 1: Write the new test case**

Following the existing `createDbMock` pattern, add a test that calls
`debitStamp({ userId, referenceId, reason: 'share' })` and asserts
the `stamp_transactions` INSERT was called with `'share'` as the
reason parameter.

Concretely, in the test:

```ts
it('records reason=share when reason option is share', async () => {
    vi.resetModules()
    const db = createDbMock()
    const { debitStamp } = await import('../netlify/lib/stamps')

    await debitStamp({
        userId: 'user-1',
        referenceId: 'share-event-1',
        reason: 'share'
    })

    // The third query is the INSERT INTO stamp_transactions (per
    // the existing test's assertion pattern).
    const insertCall = db.queries.find(q =>
        q.sql.includes('INSERT INTO stamp_transactions')
    )

    expect(insertCall).toBeDefined()
    expect(insertCall?.params).toEqual(
        expect.arrayContaining(['share'])
    )
    expect(insertCall?.params).toEqual(
        expect.arrayContaining(['share-event-1'])
    )
})

it('defaults reason to send when not provided', async () => {
    vi.resetModules()
    const db = createDbMock()
    const { debitStamp } = await import('../netlify/lib/stamps')

    await debitStamp({ userId: 'user-1' })

    const insertCall = db.queries.find(q =>
        q.sql.includes('INSERT INTO stamp_transactions')
    )

    expect(insertCall?.params).toEqual(
        expect.arrayContaining(['send'])
    )
})
```

If the existing `createDbMock` doesn't record params in the `queries`
array, adjust the mock (or the new test's assertion) to capture them.
Look at the existing mock implementation and follow its conventions.

**Step 2: Run**

```bash
cd /Users/nick/code/drerings
npx vitest run test/us003-debit-stamp.test.ts
```

Expected: new test cases pass; existing cases still pass.

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add test/us003-debit-stamp.test.ts
git commit -m "test(stamps): cover reason=share parameter in debitStamp"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->
### Task 3: `netlify/lib/shares.ts` — pure helpers (timezone + month_key)

**Verifies:** share-quota.AC4.4

**Files:**
- Create: `/Users/nick/code/drerings/netlify/lib/shares.ts`

**Step 1: Implement pure helpers first**

```ts
export function isValidIanaTimezone (tz:string):boolean {
    if (typeof tz !== 'string' || tz.length === 0) return false

    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
        return true
    } catch {
        return false
    }
}

export function monthKeyFor (
    timezone:string,
    instant:Date = new Date()
):string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit'
    }).formatToParts(instant)

    const year = parts.find(p => p.type === 'year')?.value
    const month = parts.find(p => p.type === 'month')?.value

    if (!year || !month) {
        throw new Error(`Failed to derive month key for tz=${timezone}`)
    }

    return `${year}-${month}`
}
```

**Step 2: Add types for the share library**

```ts
export type PrecheckResult =
    | { type:'free'; month_key:string }
    | { type:'paid'; stamps_balance:number; month_key:string }
    | {
        type:'blocked';
        reason:'no_free_no_stamps';
        stamps_balance:0;
        month_key:string;
    }
    | { type:'reused'; was_free:boolean }

export type ConfirmResult =
    | { type:'recorded'; was_free:boolean; stamps_balance:number }
    | { type:'blocked'; reason:'no_free_no_stamps' }

export interface PrecheckOptions {
    userId:string;
    drawingId:string;
    timezone:string;
    idempotencyKey:string;
}

export interface ConfirmOptions extends PrecheckOptions {}

export class IdempotencyConflictError extends Error {
    constructor () {
        super('idempotency_key already used for a different drawing_id')
    }
}
```

**Step 3: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/lib/shares.ts
git commit -m "feat(shares): pure helpers (isValidIanaTimezone, monthKeyFor)"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: `netlify/lib/shares.ts` — `precheckShare` (read-only)

**Verifies:** share-quota.AC4.3, share-quota.AC4.4, share-quota.AC5.1

**Files:**
- Modify: `/Users/nick/code/drerings/netlify/lib/shares.ts`

**Step 1: Implement `precheckShare`**

`precheckShare` is read-only. It looks up:
1. Existing `share_events` row by `(user_id, idempotency_key)`. If
   one exists, return `{ type:'reused', was_free }`.
2. If different `drawing_id` for same `(user_id, idempotency_key)`,
   throw `IdempotencyConflictError`.
3. Otherwise, check whether the user has used their free share this
   month: `SELECT count(*) FROM share_events WHERE user_id = $userId
   AND month_key = $monthKey AND was_free = true`.
4. If `count = 0`, return `{ type:'free', month_key }`.
5. Otherwise, read `users.stamps_balance`. If > 0, return
   `{ type:'paid', stamps_balance, month_key }`. Else return
   `{ type:'blocked', reason:'no_free_no_stamps', stamps_balance:0,
   month_key }`.

```ts
import { getDatabase } from '@netlify/database'

export async function precheckShare (
    options:PrecheckOptions
):Promise<PrecheckResult> {
    const db = getDatabase()
    const monthKey = monthKeyFor(options.timezone)

    // Step 1+2: check for existing event under this idempotency_key.
    const existing = await db.pool.query<{
        drawing_id:string;
        was_free:boolean;
    }>(`
        SELECT drawing_id, was_free
        FROM share_events
        WHERE user_id = $1 AND idempotency_key = $2
    `, [options.userId, options.idempotencyKey])

    if (existing.rows[0]) {
        if (existing.rows[0].drawing_id !== options.drawingId) {
            throw new IdempotencyConflictError()
        }
        return {
            type: 'reused',
            was_free: existing.rows[0].was_free
        }
    }

    // Step 3: has the user used their free share this month?
    const freeUsed = await db.pool.query<{ count:string }>(`
        SELECT count(*)::text AS count
        FROM share_events
        WHERE user_id = $1
            AND month_key = $2
            AND was_free = true
    `, [options.userId, monthKey])

    const freeUsedCount = parseInt(freeUsed.rows[0]?.count ?? '0', 10)

    if (freeUsedCount === 0) {
        return { type: 'free', month_key: monthKey }
    }

    // Step 4: read balance, decide paid vs blocked.
    const balanceRow = await db.pool.query<{ stamps_balance:number }>(
        'SELECT stamps_balance FROM users WHERE id = $1',
        [options.userId]
    )
    const balance = Number(balanceRow.rows[0]?.stamps_balance ?? 0)

    if (balance > 0) {
        return {
            type: 'paid',
            stamps_balance: balance,
            month_key: monthKey
        }
    }

    return {
        type: 'blocked',
        reason: 'no_free_no_stamps',
        stamps_balance: 0,
        month_key: monthKey
    }
}
```

**Step 2: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/lib/shares.ts
git commit -m "feat(shares): precheckShare returns discriminated union"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: `netlify/lib/shares.ts` — `recordShare` single-tx transaction

**Verifies:** share-quota.AC4.1, share-quota.AC4.2, share-quota.AC4.5,
share-quota.AC5.1

**Files:**
- Modify: `/Users/nick/code/drerings/netlify/lib/shares.ts`

**Design intent:** The design's "Share-confirm transaction" spec
(design plan lines 390–415) requires the entire flow — free-count
re-check, share_events INSERT, and (paid path only) the stamp debit —
to run in ONE Postgres transaction. This implementation honors that
exactly. Task 1's refactor of `debitStamp` lets us pass the caller's
client into `debitStamp`, so the stamp debit shares `recordShare`'s
transaction. **Do not commit before calling `debitStamp`.** The lock
held by `SELECT ... FOR UPDATE` is what protects the read-then-write
sequence; releasing it before the debit re-opens the race the
transaction was meant to close.

**Step 1: Implement `recordShare`**

```ts
import { debitStamp } from './stamps.js'

export async function recordShare (
    options:ConfirmOptions
):Promise<ConfirmResult> {
    const db = getDatabase()
    const monthKey = monthKeyFor(options.timezone)
    const client = await db.pool.connect()

    try {
        // Idempotency-conflict check uses pool.query (no tx needed).
        // We do it BEFORE BEGIN so we don't need to manage transaction
        // state for the throw path. The window between this read and
        // the BEGIN below is tolerable because: (a) any concurrent
        // INSERT with the same idempotency_key will fail the UNIQUE
        // constraint on insert and we will catch the conflict there
        // too; (b) the precheck endpoint already returned 'reused'
        // for this idempotency_key earlier.
        const earlyDup = await db.pool.query<{
            drawing_id:string;
            was_free:boolean;
        }>(`
            SELECT drawing_id, was_free
            FROM share_events
            WHERE user_id = $1 AND idempotency_key = $2
        `, [options.userId, options.idempotencyKey])

        if (earlyDup.rows[0]) {
            if (earlyDup.rows[0].drawing_id !== options.drawingId) {
                throw new IdempotencyConflictError()
            }
            const balanceRow = await db.pool.query<{
                stamps_balance:number;
            }>(
                'SELECT stamps_balance FROM users WHERE id = $1',
                [options.userId]
            )
            return {
                type: 'recorded',
                was_free: earlyDup.rows[0].was_free,
                stamps_balance: Number(
                    balanceRow.rows[0]?.stamps_balance ?? 0
                )
            }
        }

        await client.query('BEGIN')

        // Serialize concurrent confirms on the same user.
        await client.query(
            'SELECT id FROM users WHERE id = $1 FOR UPDATE',
            [options.userId]
        )

        // Re-check the free count under the lock.
        const freeCheck = await client.query<{ count:string }>(`
            SELECT count(*)::text AS count
            FROM share_events
            WHERE user_id = $1
                AND month_key = $2
                AND was_free = true
        `, [options.userId, monthKey])

        const freeUsedCount = parseInt(
            freeCheck.rows[0]?.count ?? '0',
            10
        )

        if (freeUsedCount === 0) {
            // Free path.
            await client.query(`
                INSERT INTO share_events
                    (user_id, drawing_id, month_key, timezone,
                     was_free, idempotency_key)
                VALUES ($1, $2, $3, $4, true, $5)
            `, [
                options.userId,
                options.drawingId,
                monthKey,
                options.timezone,
                options.idempotencyKey
            ])

            const balanceRow = await client.query<{
                stamps_balance:number;
            }>(
                'SELECT stamps_balance FROM users WHERE id = $1',
                [options.userId]
            )

            await client.query('COMMIT')

            return {
                type: 'recorded',
                was_free: true,
                stamps_balance: Number(
                    balanceRow.rows[0]?.stamps_balance ?? 0
                )
            }
        }

        // Paid path: check balance under the same lock.
        const balanceRow = await client.query<{
            stamps_balance:number;
        }>(
            'SELECT stamps_balance FROM users WHERE id = $1',
            [options.userId]
        )
        const balance = Number(
            balanceRow.rows[0]?.stamps_balance ?? 0
        )

        if (balance <= 0) {
            await client.query('ROLLBACK')
            return {
                type: 'blocked',
                reason: 'no_free_no_stamps'
            }
        }

        // Insert paid share event AND debit a stamp inside the
        // same transaction. debitStamp runs on the supplied client
        // (Task 1's refactor) — it does NOT BEGIN/COMMIT/release.
        const insert = await client.query<{ id:string }>(`
            INSERT INTO share_events
                (user_id, drawing_id, month_key, timezone,
                 was_free, idempotency_key)
            VALUES ($1, $2, $3, $4, false, $5)
            RETURNING id
        `, [
            options.userId,
            options.drawingId,
            monthKey,
            options.timezone,
            options.idempotencyKey
        ])

        const debitResult = await debitStamp({
            userId: options.userId,
            referenceId: insert.rows[0].id,
            reason: 'share',
            client  // <-- share the transaction
        })

        await client.query('COMMIT')

        return {
            type: 'recorded',
            was_free: false,
            stamps_balance: debitResult.balanceAfter
        }
    } catch (err) {
        // ROLLBACK best-effort. If we never BEGAN (the early-dup
        // path), this is a harmless no-op.
        try {
            await client.query('ROLLBACK')
        } catch {
            // ignore
        }
        // Map UNIQUE-constraint violation on (user_id, idempotency_key)
        // to IdempotencyConflictError so callers get a consistent
        // 409 mapping. This covers the rare case where another
        // concurrent confirm inserted between our earlyDup check and
        // our INSERT.
        if (isUniqueViolation(err)) {
            throw new IdempotencyConflictError()
        }
        throw err
    } finally {
        client.release()
    }
}

function isUniqueViolation (err:unknown):boolean {
    // Postgres error code 23505: unique_violation.
    return !!err
        && typeof err === 'object'
        && (err as { code?:string }).code === '23505'
}
```

**Why this preserves AC4.2 atomicity:** `share_events` insert and the
`stamp_transactions` insert (inside `debitStamp`) are both written
under the same transaction. Either both rows are visible after COMMIT
or neither is (on ROLLBACK). The `FOR UPDATE` on the user row is held
until COMMIT — so the read of `stamps_balance` and the write inside
`debitStamp` are serialized against any concurrent confirm for the
same user.

**Why `debitStamp` cannot fail post-balance-check:** with the
`stamps_balance > 0` precondition verified under FOR UPDATE, the
existing `debitStamp` logic (FIFO lot selection with `SKIP LOCKED`)
will find at least one lot — assuming `verifyStampInvariants` is
clean. If invariants are broken AND a debit fails, the COMMIT does
not happen and the share_events row is never written. This is exactly
the contract the design specifies.

**Step 2: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/lib/shares.ts
git commit -m "feat(shares): recordShare with FOR UPDATE re-check and debit"
```
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-7) -->

<!-- START_TASK_6 -->
### Task 6: `/api/shares/precheck` endpoint

**Verifies:** share-quota.AC3.3 (401 without session)

**Files:**
- Create: `/Users/nick/code/drerings/netlify/functions/shares/precheck.ts`

**Step 1: Implement**

```ts
import type { Handler } from '@netlify/functions'
import { json, parseJsonBody } from '../../lib/http.js'
import { getSession } from '../../lib/session.js'
import {
    isValidIanaTimezone,
    precheckShare,
    IdempotencyConflictError
} from '../../lib/shares.js'
import * as postStore from '../../lib/posts.js'

interface ParsedBody {
    drawing_id:string;
    timezone:string;
    idempotency_key:string;
}

function parseBody (raw:unknown):ParsedBody|null {
    if (!raw || typeof raw !== 'object') return null
    const body = raw as Partial<ParsedBody>

    if (typeof body.drawing_id !== 'string' ||
        body.drawing_id.length === 0) return null
    if (typeof body.timezone !== 'string') return null
    if (typeof body.idempotency_key !== 'string' ||
        body.idempotency_key.length === 0) return null

    return {
        drawing_id: body.drawing_id,
        timezone: body.timezone,
        idempotency_key: body.idempotency_key
    }
}

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const session = await getSession(event)
    if (!session) return json(401, { error: 'Please sign in.' })

    const body = parseBody(parseJsonBody(event))
    if (!body) return json(400, { error: 'Invalid request body.' })

    if (!isValidIanaTimezone(body.timezone)) {
        return json(400, { error: 'Invalid timezone.' })
    }

    const owns = await postStore.userOwnsDrawing(
        session.user.id,
        body.drawing_id
    )
    if (!owns) return json(404, { error: 'Drawing not found.' })

    try {
        const result = await precheckShare({
            userId: session.user.id,
            drawingId: body.drawing_id,
            timezone: body.timezone,
            idempotencyKey: body.idempotency_key
        })

        return json(200, result)
    } catch (err) {
        if (err instanceof IdempotencyConflictError) {
            return json(409, {
                error: 'idempotency_conflict',
                message: err.message
            })
        }

        throw err
    }
}
```

**Step 2: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/functions/shares/precheck.ts
git commit -m "feat(shares): POST /api/shares/precheck"
```
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: `/api/shares/confirm` endpoint

**Verifies:** share-quota.AC3.4 (401 without session),
share-quota.AC4.6 (409 on idempotency conflict)

**Files:**
- Create: `/Users/nick/code/drerings/netlify/functions/shares/confirm.ts`

**Step 1: Implement**

```ts
import type { Handler } from '@netlify/functions'
import { json, parseJsonBody } from '../../lib/http.js'
import { getSession } from '../../lib/session.js'
import {
    isValidIanaTimezone,
    recordShare,
    IdempotencyConflictError
} from '../../lib/shares.js'
import * as postStore from '../../lib/posts.js'

interface ParsedBody {
    drawing_id:string;
    timezone:string;
    idempotency_key:string;
}

function parseBody (raw:unknown):ParsedBody|null {
    if (!raw || typeof raw !== 'object') return null
    const body = raw as Partial<ParsedBody>

    if (typeof body.drawing_id !== 'string' ||
        body.drawing_id.length === 0) return null
    if (typeof body.timezone !== 'string') return null
    if (typeof body.idempotency_key !== 'string' ||
        body.idempotency_key.length === 0) return null

    return {
        drawing_id: body.drawing_id,
        timezone: body.timezone,
        idempotency_key: body.idempotency_key
    }
}

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const session = await getSession(event)
    if (!session) return json(401, { error: 'Please sign in.' })

    const body = parseBody(parseJsonBody(event))
    if (!body) return json(400, { error: 'Invalid request body.' })

    if (!isValidIanaTimezone(body.timezone)) {
        return json(400, { error: 'Invalid timezone.' })
    }

    const owns = await postStore.userOwnsDrawing(
        session.user.id,
        body.drawing_id
    )
    if (!owns) return json(404, { error: 'Drawing not found.' })

    try {
        const result = await recordShare({
            userId: session.user.id,
            drawingId: body.drawing_id,
            timezone: body.timezone,
            idempotencyKey: body.idempotency_key
        })

        return json(200, result)
    } catch (err) {
        if (err instanceof IdempotencyConflictError) {
            return json(409, {
                error: 'idempotency_conflict',
                message: err.message
            })
        }

        throw err
    }
}
```

**Step 2: Build**

```bash
cd /Users/nick/code/drerings
npx tsc --noEmit
```

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/functions/shares/confirm.ts
git commit -m "feat(shares): POST /api/shares/confirm"
```
<!-- END_TASK_7 -->

<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D (tasks 8-9) -->

<!-- START_TASK_8 -->
### Task 8: Tests — `monthKeyFor`, `isValidIanaTimezone`, `precheckShare`

**Verifies:** share-quota.AC4.3, share-quota.AC4.4, share-quota.AC5.1

**Files:**
- Create: `/Users/nick/code/drerings/test/us020-shares-precheck.test.ts`

**Step 1: Pure-helper tests** (no DB mock needed):

```ts
import { describe, expect, it } from 'vitest'
import {
    isValidIanaTimezone,
    monthKeyFor
} from '../netlify/lib/shares'

describe('isValidIanaTimezone', () => {
    it('accepts well-known IANA names', () => {
        expect(isValidIanaTimezone('America/New_York')).toBe(true)
        expect(isValidIanaTimezone('UTC')).toBe(true)
        expect(isValidIanaTimezone('Asia/Tokyo')).toBe(true)
    })

    it('rejects invalid inputs', () => {
        expect(isValidIanaTimezone('')).toBe(false)
        expect(isValidIanaTimezone('Not/A/Zone')).toBe(false)
    })
})

describe('monthKeyFor', () => {
    it('formats year-month using the supplied timezone', () => {
        const newYearsUTC = new Date('2026-01-01T00:30:00Z')
        // 30 min after midnight UTC = still 2025-12-31 in
        // America/New_York (UTC-5)
        expect(monthKeyFor('America/New_York', newYearsUTC))
            .toBe('2025-12')
        expect(monthKeyFor('UTC', newYearsUTC)).toBe('2026-01')
    })
})
```

**Step 2: DB-mocked precheckShare tests**

Add tests covering the four return shapes (`free`, `paid`, `blocked`,
`reused`). Use the `createDbMock` pattern from
`test/us003-debit-stamp.test.ts:1–95`. The mock should branch on
which SQL is being executed.

For brevity in this plan, define one detailed test case (the
implementor will follow the pattern for the rest):

```ts
import { vi } from 'vitest'

it('returns free when user has no prior share this month', async () => {
    vi.resetModules()

    const releases:Array<()=>void> = []
    const query = vi.fn(async (sql:string, _params?:unknown[]) => {
        if (sql.includes('FROM share_events')
            && sql.includes('idempotency_key')) {
            return { rows: [] } // no prior event
        }
        if (sql.includes('count(*)') && sql.includes('share_events')) {
            return { rows: [{ count: '0' }] } // no free used yet
        }
        return { rows: [] }
    })

    vi.doMock('@netlify/database', () => ({
        getDatabase: () => ({ pool: { query, connect: async () => ({
            query,
            release: () => { releases.push(() => {}) }
        }) } })
    }))

    const { precheckShare } = await import('../netlify/lib/shares')
    const result = await precheckShare({
        userId: 'user-1',
        drawingId: 'drawing-1',
        timezone: 'UTC',
        idempotencyKey: 'idem-1'
    })

    expect(result.type).toBe('free')
    if (result.type === 'free') {
        expect(result.month_key).toMatch(/^\d{4}-\d{2}$/)
    }
})
```

Add similar test cases for `paid` (free used + balance>0), `blocked`
(free used + balance=0), and `reused` (existing event with same
idempotency_key). For `reused` also test the `IdempotencyConflictError`
path (existing event has a different `drawing_id`).

**Step 3: Run**

```bash
cd /Users/nick/code/drerings
npx vitest run test/us020-shares-precheck.test.ts
```

**Step 4: Commit**

```bash
cd /Users/nick/code/drerings
git add test/us020-shares-precheck.test.ts
git commit -m "test(shares): precheckShare unit tests"
```
<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: Tests — `recordShare` (free, paid, blocked, concurrent)

**Verifies:** share-quota.AC4.1, share-quota.AC4.2, share-quota.AC4.5,
share-quota.AC5.1

**Files:**
- Create: `/Users/nick/code/drerings/test/us020-shares-record.test.ts`

**Step 1: Write the four test cases**

Following the same `createDbMock` pattern, write tests for:

1. **Free path:** No prior share row, no prior free-this-month row.
   `recordShare` should call the `INSERT INTO share_events` with
   `was_free=true` in the params, and the returned `ConfirmResult`
   should be `{ type:'recorded', was_free:true, stamps_balance }`.
   Verify no call to `debitStamp` (no INSERT into stamp_transactions).

2. **Paid path:** Free-this-month count is `1` and the user has
   `stamps_balance:5`. `recordShare` should insert with `was_free=false`,
   then `debitStamp` should be called with `reason:'share'` and
   `referenceId` matching the inserted row. Return
   `{ type:'recorded', was_free:false, stamps_balance:4 }`.

3. **Blocked path:** Free-this-month count is `1` and
   `stamps_balance:0`. `recordShare` returns
   `{ type:'blocked', reason:'no_free_no_stamps' }` with no INSERT.

4. **Concurrent confirm:** Two `recordShare` calls execute back-to-back.
   The mocked query function returns `count = 0` the first time the
   free-count query runs and `count = 1` the second time (simulating
   that the first transaction wrote a free row before the second
   transaction's lock-acquisition). The second call's return should
   be `{ type:'recorded', was_free:false, ... }` (paid) if the mock
   represents `stamps_balance > 0`, or
   `{ type:'blocked', reason:'no_free_no_stamps' }` if balance is `0`.

Concurrent test in detail:

```ts
it('serializes concurrent confirms via FOR UPDATE re-check', async () => {
    vi.resetModules()

    let freeCount = 0
    const queries:Array<{ sql:string; params:unknown[] }> = []
    const balance = { value: 0 }

    const query = vi.fn(async (sql:string, params?:unknown[]) => {
        queries.push({ sql, params: params ?? [] })

        if (sql.includes('FROM share_events')
            && sql.includes('idempotency_key = $2')) {
            return { rows: [] } // no prior event
        }
        if (sql.includes('count(*)')
            && sql.includes('share_events')) {
            // The first call sees 0 (free path), the second sees 1.
            const c = freeCount
            return { rows: [{ count: String(c) }] }
        }
        if (sql.includes('INSERT INTO share_events')) {
            const wasFree = params?.[4]
            if (wasFree === true) freeCount = 1
            return { rows: [{ id: 'event-' + queries.length }] }
        }
        if (sql.includes('SELECT id FROM users')
            && sql.includes('FOR UPDATE')) {
            return { rows: [{ id: 'user-1' }] }
        }
        if (sql.includes('stamps_balance FROM users')) {
            return { rows: [{ stamps_balance: balance.value }] }
        }
        return { rows: [] }
    })

    vi.doMock('@netlify/database', () => ({
        getDatabase: () => ({
            pool: {
                query,
                connect: async () => ({
                    query,
                    release: vi.fn()
                })
            }
        })
    }))

    const { recordShare } = await import('../netlify/lib/shares')

    const first = await recordShare({
        userId: 'user-1',
        drawingId: 'drawing-1',
        timezone: 'UTC',
        idempotencyKey: 'idem-1'
    })
    expect(first).toEqual(expect.objectContaining({
        type: 'recorded',
        was_free: true
    }))

    const second = await recordShare({
        userId: 'user-1',
        drawingId: 'drawing-2',
        timezone: 'UTC',
        idempotencyKey: 'idem-2'
    })
    // No stamps -> blocked
    expect(second).toEqual({
        type: 'blocked',
        reason: 'no_free_no_stamps'
    })
})
```

**Step 2: Run**

```bash
cd /Users/nick/code/drerings
npx vitest run test/us020-shares-record.test.ts
```

**Step 3: Commit**

```bash
cd /Users/nick/code/drerings
git add test/us020-shares-record.test.ts
git commit -m "test(shares): recordShare unit tests covering all paths"
```
<!-- END_TASK_9 -->

<!-- END_SUBCOMPONENT_D -->

---

## Done When

- `netlify/lib/shares.ts` exports `isValidIanaTimezone`, `monthKeyFor`,
  `precheckShare`, `recordShare`, `IdempotencyConflictError`.
- `netlify/functions/shares/precheck.ts` and
  `netlify/functions/shares/confirm.ts` exist and authed-only.
- `netlify/lib/stamps.ts:debitStamp` accepts `reason?:'send'|'share'`.
- `npx tsc --noEmit` exits 0.
- `npx vitest run test/us020-shares-*.test.ts test/us003-debit-stamp.test.ts`
  passes.
- Unauthed `POST /api/shares/precheck` and `POST /api/shares/confirm`
  return 401.
- A confirm request with mismatched `idempotency_key` / `drawing_id`
  returns 409.
- Concurrent confirms test demonstrates one free + one paid (or
  blocked) outcome at most.
