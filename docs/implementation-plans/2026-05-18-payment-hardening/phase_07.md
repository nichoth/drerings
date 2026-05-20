# Phase 7: Rate limiting (P1-5) Implementation Plan

**Goal:** Apply per-IP / per-user rate limits to five endpoints: `/api/auth/login`, `/api/postcards/send`, `/api/shares/confirm`, `/api/billing/checkout`, `/api/stamps/gifts/checkout`. Today none of them are limited; a compromised account can drain its stamps in milliseconds, and login is an open handle-enumeration / PDS-flood vector.

**Architecture:** Fixed-window token-bucket in Postgres. One table `rate_limit_buckets(key TEXT PRIMARY KEY, window_start TIMESTAMPTZ, count INTEGER)` with an atomic `INSERT … ON CONFLICT DO UPDATE` that either resets the window or increments the count, returning the post-increment value. A new `netlify/lib/rate-limit.ts` module exposes `checkAndIncrement(key, max, windowSeconds)` returning `{allowed, remaining, resetAt}`. Endpoint handlers compose keys: `user:{id}:{endpoint}` for authed routes, `ip:{addr}:{endpoint}` for `auth/login`. On exceed, handlers return HTTP 429 with `Retry-After` and the IETF-draft `RateLimit` / `RateLimit-Policy` headers. Netlify's built-in `config.rateLimit` is **not** used (insufficient granularity — IP+domain only, no per-user keys).

**Tech Stack:** TypeScript 5.8, Postgres via `@netlify/database`, `vitest`.

**Scope:** Phase 7 of 7.

**Codebase verified:** 2026-05-18.
- No existing rate-limit utility (`grep "rate.?limit\|throttle\|RateLimit" netlify/ src/` returns zero hits).
- No Edge Functions in repo. Standard Functions only (`netlify.toml [functions]` block, line 27-29).
- Request IP is not extracted today. Netlify forwards two headers we can use: `x-nf-client-connection-ip` (preferred, Netlify-native) and `x-forwarded-for` (fallback).
- `getSession(event)` (`netlify/lib/session.ts:54-77`) returns `{user: {id, did, handle, ...}}` — `user.id` is the natural key for authed limits.
- Each target handler validates session early (per Phase 7B investigator); we attach the rate-limit check right after session validation for authed endpoints, and at the very top for `auth/login` (no session there).
- Tests mock `getDatabase().pool.query` per the standard pattern (e.g., `test/us020-shares-record.test.ts`).
- Phase 4 used migration 0016. Phase 7's migration is **0017**.

---

## Acceptance Criteria Coverage

### payment-hardening.AC20: `rate_limit_buckets` table

- **payment-hardening.AC20.1 Success — schema:** After migration 0017, table `rate_limit_buckets` exists with columns `key TEXT PRIMARY KEY`, `window_start TIMESTAMPTZ NOT NULL DEFAULT now()`, `count INTEGER NOT NULL DEFAULT 0`.
- **payment-hardening.AC20.2 Defensive — idempotent re-run:** Re-running migration 0017 is a no-op.

### payment-hardening.AC21: `checkAndIncrement` helper

- **payment-hardening.AC21.1 Success — under limit:** First call with `(key='user:U:postcards', max=30, windowSeconds=60)` returns `{allowed: true, remaining: 29, resetAt: <60s ahead>}` and increments the row's `count` to 1.
- **payment-hardening.AC21.2 Success — repeated within window:** Subsequent calls within the same window return decreasing `remaining` (29, 28, …, 0).
- **payment-hardening.AC21.3 Failure — over limit:** When `count > max`, returns `{allowed: false, remaining: 0, resetAt}`. The row's `count` is incremented past `max` but is reset on window rollover.
- **payment-hardening.AC21.4 Success — window rollover:** When `now - window_start >= windowSeconds`, the row's `window_start` resets to `now()` and `count` resets to 1. Returns `{allowed: true, remaining: max-1, resetAt: now+windowSeconds}`.
- **payment-hardening.AC21.5 Concurrent — atomic increment:** Two parallel `checkAndIncrement` calls produce `count = 2` (no lost update). Verified via the `INSERT … ON CONFLICT DO UPDATE … RETURNING` round-trip atomicity.
- **payment-hardening.AC21.6 Sustained over-limit:** A key that is queried every second past `max` continues to return `{allowed:false}` until `windowSeconds` has elapsed since the LAST `window_start` reset. The ELSE branch in the CASE expression preserves `window_start`, so wall-clock time advances independently of request rate.

### payment-hardening.AC22: `getClientIp` helper

- **payment-hardening.AC22.1 Success — Netlify header:** When `event.headers['x-nf-client-connection-ip']` is present, returns its value.
- **payment-hardening.AC22.2 Fallback — XFF first hop:** When `x-nf-client-connection-ip` is missing and `x-forwarded-for` is `'1.2.3.4, 5.6.7.8'`, returns `'1.2.3.4'`.
- **payment-hardening.AC22.3 Defensive — no headers:** Returns `'unknown'`. Note: `@netlify/functions` types headers as `Record<string,string|undefined>` (never arrays), so the implementation only handles string values; array handling is unnecessary.

### payment-hardening.AC23: Endpoints enforce rate limits

- **payment-hardening.AC23.1 `/api/auth/login` — per-IP 10/min:** 10 requests from the same IP within 60s succeed. The 11th returns 429.
- **payment-hardening.AC23.2 `/api/postcards/send` — per-user 30/min:** 30 calls succeed; the 31st returns 429. Limit attaches AFTER session validation (no anonymous traffic counts).
- **payment-hardening.AC23.3 `/api/shares/confirm` — per-user 30/min:** Same envelope as postcards/send.
- **payment-hardening.AC23.4 `/api/billing/checkout` — per-user 5/min:** 5 calls succeed; the 6th returns 429.
- **payment-hardening.AC23.5 `/api/stamps/gifts/checkout` — per-user 5/min:** Same as billing/checkout.
- **payment-hardening.AC23.6 Response shape on 429:** `429` responses include `Retry-After: <seconds>`, `RateLimit-Policy: "default";q=<max>;w=<windowSeconds>`, `RateLimit: "default";r=0;t=<seconds-until-reset>`, and JSON body `{error: 'rate_limited'}`.
- **payment-hardening.AC23.7 No regression — under-limit:** Requests below the cap return the existing status codes (200/401/etc.) and bodies unchanged.

---

## Tasks

<!-- START_TASK_1 -->
### Task 1: Migration 0017 — `rate_limit_buckets` table

**Verifies:** payment-hardening.AC20.1, AC20.2 (infrastructure)

**Files:**
- Create: `netlify/database/migrations/0017_rate_limit_buckets/migration.sql`
- Create: `netlify/database/migrations/0017_rate_limit_buckets/down.sql`

**Implementation:**

`netlify/database/migrations/0017_rate_limit_buckets/migration.sql`:

```sql
-- 0017_rate_limit_buckets
-- Fixed-window token-bucket store for per-endpoint rate limiting.
--
-- Each row tracks one logical bucket. The key is composed by callers
-- as either:
--   user:{user_id}:{endpoint}
--   ip:{ip_addr}:{endpoint}
--
-- Buckets are not actively pruned. A periodic vacuum/cleanup job MAY
-- delete rows with stale window_start (e.g. older than 24h) but is not
-- required for correctness — stale rows simply roll their window on
-- next access.

BEGIN;

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    key             TEXT PRIMARY KEY,
    window_start    TIMESTAMPTZ NOT NULL DEFAULT now(),
    count           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_window_start
    ON rate_limit_buckets(window_start);

COMMIT;
```

`netlify/database/migrations/0017_rate_limit_buckets/down.sql`:

```sql
BEGIN;

DROP TABLE IF EXISTS rate_limit_buckets;

COMMIT;
```

**Verification:**

```sh
psql "$DATABASE_URL" -f netlify/database/migrations/0017_rate_limit_buckets/migration.sql
psql "$DATABASE_URL" -c "\d+ rate_limit_buckets"
```
Expected: three columns; primary key on `key`.

Idempotent re-run:
```sh
psql "$DATABASE_URL" -f netlify/database/migrations/0017_rate_limit_buckets/migration.sql
```
Expected: no error.

**Commit:** `feat(db): add rate_limit_buckets table (migration 0017)`
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->

<!-- START_TASK_2 -->
### Task 2: `netlify/lib/rate-limit.ts` — `checkAndIncrement` + `getClientIp` + `rateLimitResponse`

**Verifies:** payment-hardening.AC21.1, AC21.2, AC21.3, AC21.4, AC21.5, AC22.1, AC22.2, AC22.3, AC23.6

**Files:**
- Create: `netlify/lib/rate-limit.ts`
- Create: `test/us039-rate-limit.test.ts` (unit, vitest)

**Implementation:**

```ts
// pattern: Functional Core (helpers) + Imperative Shell (DB call)
import { getDatabase } from '@netlify/database'
import type { HandlerEvent, HandlerResponse } from '@netlify/functions'

export interface RateLimitCheck {
    allowed:boolean;
    remaining:number;
    resetAt:Date;
}

interface RateLimitRow {
    count:number|string;
    window_start:string|Date;
}

/**
 * Atomic fixed-window token-bucket check.
 *
 * One round-trip: INSERT a fresh bucket OR (on conflict) reset-or-
 * increment the existing one in a single statement. Returns the
 * post-increment count plus the window's start so callers can derive
 * `resetAt`.
 *
 * The CASE expression in DO UPDATE handles window rollover atomically:
 * if `now() - window_start >= windowSeconds` the bucket resets to
 * count=1 and a fresh window_start; otherwise count is incremented.
 */
export async function checkAndIncrement (
    key:string,
    max:number,
    windowSeconds:number
):Promise<RateLimitCheck> {
    const db = getDatabase()
    const result = await db.pool.query<RateLimitRow>(`
        INSERT INTO rate_limit_buckets (key, window_start, count)
        VALUES ($1, now(), 1)
        ON CONFLICT (key) DO UPDATE
            SET count = CASE
                    WHEN EXTRACT(EPOCH FROM (now() - rate_limit_buckets.window_start)) >= $2
                        THEN 1
                    ELSE rate_limit_buckets.count + 1
                END,
                window_start = CASE
                    WHEN EXTRACT(EPOCH FROM (now() - rate_limit_buckets.window_start)) >= $2
                        THEN now()
                    ELSE rate_limit_buckets.window_start
                END
        RETURNING count, window_start
        -- PostgreSQL's now() is transaction_timestamp() — stable across all
        -- evaluations within a single statement. The two now() calls in this
        -- INSERT and the two in the ON CONFLICT CASE expressions all read the
        -- same instant. No race window inside this statement.
    `, [key, windowSeconds])

    const row = result.rows[0]
    const count = Number(row.count)
    const windowStart = new Date(row.window_start as string|Date)
    const resetAt = new Date(
        windowStart.getTime() + windowSeconds * 1000
    )
    const allowed = count <= max
    const remaining = Math.max(0, max - count)

    return { allowed, remaining, resetAt }
}

/**
 * Extract the request's client IP from Netlify-forwarded headers.
 * Prefers `x-nf-client-connection-ip` (Netlify-native, single value)
 * over `x-forwarded-for` (comma-separated chain — first hop wins).
 */
export function getClientIp (event:HandlerEvent):string {
    const headers = event.headers
    const netlifyIp = headers['x-nf-client-connection-ip']
    if (typeof netlifyIp === 'string' && netlifyIp.trim()) {
        return netlifyIp.trim()
    }

    const xff = headers['x-forwarded-for']
    if (typeof xff === 'string' && xff.trim()) {
        const firstHop = xff.split(',')[0].trim()
        if (firstHop) return firstHop
    }

    return 'unknown'
}

/**
 * Build a 429 HandlerResponse. Includes Retry-After (seconds), the new
 * IETF-draft RateLimit / RateLimit-Policy structured-field headers, and
 * a small JSON body.
 *
 * See draft-ietf-httpapi-ratelimit-headers (2026-current).
 */
export function rateLimitResponse (
    check:RateLimitCheck,
    max:number,
    windowSeconds:number
):HandlerResponse {
    const secondsUntilReset = Math.max(
        0,
        Math.ceil((check.resetAt.getTime() - Date.now()) / 1000)
    )

    return {
        statusCode: 429,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-store',
            'Retry-After': String(secondsUntilReset),
            'RateLimit-Policy': `"default";q=${max};w=${windowSeconds}`,
            'RateLimit':
                `"default";r=${check.remaining};t=${secondsUntilReset}`
        },
        body: JSON.stringify({ error: 'rate_limited' })
    }
}
```

**Testing:**

`test/us039-rate-limit.test.ts` covers AC21/22/23.6:

For `checkAndIncrement` (AC21):
- AC21.1: Mock `db.pool.query` to return `[{count: 1, window_start: <now>}]`. Call with `max=30`. Assert `{allowed:true, remaining:29, resetAt: now+60s}`.
- AC21.2: Successive calls — mock returns increasing counts (2, 3, …). Assert `remaining` decreases.
- AC21.3: Mock returns `[{count: 31, window_start: <now>}]` with `max=30`. Assert `allowed:false, remaining:0`.
- AC21.4: Mock returns `[{count: 1, window_start: <fresh window start>}]` after the window-rollover branch — same shape, assert resetAt computed correctly.
- AC21.5: Concurrent dispatch — fire `Promise.all([cAndI(...), cAndI(...)])` with a shared mock counter. Assert the underlying SQL has `ON CONFLICT (key) DO UPDATE … RETURNING count`, which is atomic by Postgres semantics. Test assertion: counter increments by 2, no lost update.

For `getClientIp` (AC22):
- AC22.1: `headers: {'x-nf-client-connection-ip': '1.2.3.4'}` → returns `'1.2.3.4'`.
- AC22.2: `headers: {'x-forwarded-for': '1.2.3.4, 5.6.7.8'}` → returns `'1.2.3.4'`.
- AC22.3: `headers: {}` → returns `'unknown'`.

For `rateLimitResponse` (AC23.6):
- One assertion building a response from a `{allowed:false, remaining:0, resetAt: now+30s}` check with `max=30, windowSeconds=60`. Verify `statusCode:429`, `Retry-After:30`, `RateLimit-Policy: '"default";q=30;w=60'`, `RateLimit: '"default";r=0;t=30'`, body is `{error:'rate_limited'}`.

**Verification:**
```sh
npx vitest run test/us039-rate-limit.test.ts
```

**Commit:** `feat(rate-limit): checkAndIncrement + getClientIp + 429 response helpers`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire `/api/auth/login` (per-IP, 10/min)

**Verifies:** payment-hardening.AC23.1

**Files:**
- Modify: `netlify/functions/auth/login.ts` — add rate-limit gate at the top of the handler
- Modify: `test/us020-auth-callback.test.ts` (or create `test/us039-rate-limit-login.test.ts` if cleaner) — assert 11th-call returns 429

**Implementation:**

Read the existing handler (`netlify/functions/auth/login.ts`). The skill assumes the engineer has zero context — investigator-confirmed shape: a small `Handler` that takes `event`, reads `handle` from query string, and 302-redirects to the PDS authorization URL.

Insert at the top of the handler (before any handle parsing):

```ts
import {
    checkAndIncrement,
    getClientIp,
    rateLimitResponse
} from '../../lib/rate-limit.js'

// inside the handler:
const ip = getClientIp(event)
const limit = await checkAndIncrement(
    `ip:${ip}:auth/login`,
    10,
    60
)
if (!limit.allowed) {
    return rateLimitResponse(limit, 10, 60)
}
```

The remainder of the handler is unchanged.

**Placement rule:** The rate-limit gate goes AFTER the HTTP method check (so non-method probes don't burn the bucket) but BEFORE handle parsing.

**Testing:**

In `test/us039-rate-limit-login.test.ts`:

- AC23.1 under-limit: Mock `checkAndIncrement` to return `{allowed:true, remaining:9, resetAt}`. Call handler. Assert the existing 302 response.
- AC23.1 over-limit: Mock to return `{allowed:false, remaining:0, resetAt}`. Call handler. Assert 429 response with the AC23.6 headers.

**Verification:**
```sh
npx vitest run test/us039-rate-limit-login.test.ts test/us020-auth-callback.test.ts
```
Expected: all pass.

**Commit:** `feat(auth): rate-limit /api/auth/login to 10/min/IP`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Wire the four authed endpoints (per-user)

**Verifies:** payment-hardening.AC23.2, AC23.3, AC23.4, AC23.5

**Note on constraint overlap:** `shares/confirm` already has a UNIQUE constraint on `(user_id, idempotency_key)` from migration 0011, preventing replay of the same drawing-share within the same `idempotency_key`. The rate limit is an additional defense with a different concern — bounding request rate vs preventing same-key replay. The overlap is intentional and defensive: the idempotency key prevents accidental duplicate records; the rate limit prevents exhaustion of request quota.

**Files:**
- Modify: `netlify/functions/postcards/send.ts` — add rate-limit gate after `getSession` succeeds (30/min)
- Modify: `netlify/functions/shares/confirm.ts` — same (30/min)
- Modify: `netlify/functions/billing/checkout.ts` — same (5/min)
- Modify: `netlify/functions/stamps/gifts/checkout.ts` — same (5/min)
- Create: `test/us039-rate-limit-endpoints.test.ts` (integration, vitest)

**Implementation:**

In each of the four handlers, immediately after the existing `if (!session) return json(401, ...)` check, insert the rate-limit gate. The four handlers all use the same variable name `session` returned by `getSession()`, and `session.user.id` is the UUID key.

```ts
import {
    checkAndIncrement,
    rateLimitResponse
} from '../../lib/rate-limit.js' // adjust path depth per file

// inside handler, after session check:
const RATE_MAX = 30      // or 5 for checkout endpoints
const RATE_WINDOW = 60
const limit = await checkAndIncrement(
    `user:${session.user.id}:postcards/send`, // change endpoint suffix per file
    RATE_MAX,
    RATE_WINDOW
)
if (!limit.allowed) {
    return rateLimitResponse(limit, RATE_MAX, RATE_WINDOW)
}
```

**Placement rule:** For authed endpoints the order is: method → session → rate-limit → body validation → domain logic (so anonymous requests get 401 first, not 429).

Per-endpoint values:

| Endpoint | Key suffix | max | window |
|----------|------------|-----|--------|
| `postcards/send.ts` | `postcards/send` | 30 | 60 |
| `shares/confirm.ts` | `shares/confirm` | 30 | 60 |
| `billing/checkout.ts` | `billing/checkout` | 5 | 60 |
| `stamps/gifts/checkout.ts` | `stamps/gifts/checkout` | 5 | 60 |

The relative import path for `../../lib/rate-limit.js` works for the top-level handlers under `netlify/functions/*/`; verify the `../../../lib/rate-limit.js` path for `stamps/gifts/checkout.ts` (which is one level deeper).

**Exact insertion points:**

All four handlers return `session` from `getSession()` and use `session.user.id` as the UUID key. Insertion points (immediately after the session check):

- **`netlify/functions/postcards/send.ts:23-27`** — After `const session = await getSession(event)` (line 23) and the check `if (!session)` (lines 25–26), insert the rate-limit gate. Reference: `session.user.id` at line 23's variable.
- **`netlify/functions/shares/confirm.ts:39-40`** — After `const session = await getSession(event)` (line 39) and the one-line check `if (!session) return json(401, ...)` (line 40), insert the rate-limit gate. Reference: `session.user.id` at line 50 (existing usage downstream).
- **`netlify/functions/billing/checkout.ts:19-22`** — After `const session = await getSession(event)` (line 19) and the check `if (!session)` (lines 20–21), insert the rate-limit gate. Reference: `session.user.id` used at line 31+ (existing usage downstream).
- **`netlify/functions/stamps/gifts/checkout.ts:17-21`** — After `const session = await getSession(event)` (line 17) and the check `if (!session)` (lines 19–20), insert the rate-limit gate. Reference: `session.user.id` used at lines 30+ (existing usage downstream).

**Testing:**

`test/us039-rate-limit-endpoints.test.ts` covers AC23.2-23.5. For each of the four endpoints:

- Under-limit: Mock `checkAndIncrement` to return `{allowed:true, ...}`. Mock session and other deps for a happy-path request. Assert original status (200 for postcards/send and shares/confirm; 200 for checkout endpoints) is returned and the response body is unchanged.
- Over-limit: Mock `checkAndIncrement` to return `{allowed:false, remaining:0, resetAt: now+30s}`. Assert response is 429 with AC23.6 headers AND that the underlying business logic mocks (e.g., `recordShare`, `findOrCreateQueuedPostcard`, `createCheckoutSession`) were NOT called.

This file will contain 8 tests (4 endpoints × 2 paths).

**Verification:**
```sh
npx vitest run test/us039-rate-limit-endpoints.test.ts
```

```sh
grep -n "checkAndIncrement" netlify/functions/postcards/send.ts netlify/functions/shares/confirm.ts netlify/functions/billing/checkout.ts netlify/functions/stamps/gifts/checkout.ts
```
Expected: one match per file.

**Commit:** `feat(api): rate-limit authed endpoints (postcards/send, shares/confirm, billing/checkout, gifts/checkout)`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Full suite verification

**Verifies:** Phase 7 regression-free + AC23.7.

**Files:** none — verification only.

**Verification:**
```sh
npm run lint && npx vitest run
```
Expected: lint passes; all tests pass (including AC23.7 — under-limit behavior of every existing endpoint test stays green).

Spot check the rate-limit calls are in place:
```sh
grep -rn "checkAndIncrement" netlify/functions/
```
Expected: five matches (login, postcards/send, shares/confirm, billing/checkout, gifts/checkout).

**Commit:** none.
<!-- END_TASK_5 -->

---

## Phase 7 Done When

- Migration 0017 applied; `rate_limit_buckets` exists in dev/staging.
- `netlify/lib/rate-limit.ts` exposes `checkAndIncrement`, `getClientIp`, `rateLimitResponse`.
- All five target endpoints invoke `checkAndIncrement` before their domain logic.
- 429 responses carry `Retry-After`, `RateLimit-Policy`, and `RateLimit` headers.
- Unit + integration tests cover under-limit and over-limit paths for each endpoint.
- `npm run lint && npx vitest run` is green.

## Operator notes

- `rate_limit_buckets` is intentionally append-light (one row per active key). For long-tail keys (e.g., one-time visitors hitting login), rows accumulate. A nightly cleanup job — `DELETE FROM rate_limit_buckets WHERE window_start < now() - interval '24 hours'` — is a follow-up if table size warrants. Not blocking.
- If 429s arrive in production and a user wants to be unblocked early, an operator can `DELETE FROM rate_limit_buckets WHERE key = '<key>'`. The next request starts a fresh window.
- Login limit (`10/min/IP`) is intentionally tight — that's a brute-force / handle-enumeration gate, not a UX feature. The 5/min checkout limits exist to bound Autumn API spend; raise carefully if usage warrants.
- `checkAndIncrement` always increments — even when over the limit. That bounds the window-rollover behavior cleanly: a user who keeps hammering past the cap doesn't reset their bucket by chance; the bucket resets only when wall-clock `windowSeconds` have passed since `window_start`.
- **Count growth under sustained attack:** The CASE expression's ELSE branch increments `count` indefinitely until the window rolls. INTEGER caps at ~2.1B; a sustained-attack key would have to push >35M req/sec for the full windowSeconds to risk overflow. Not a practical concern, but if the operator notices a `count` value approaching Int32 max in `SELECT * FROM rate_limit_buckets ORDER BY count DESC LIMIT 10`, the attacker has been blocked but the bucket should be DELETEd to reset cleanly.
