# Phase 1: Database Migrations Implementation Plan

**Goal:** Reset schema for DID-keyed users; add `share_events`; extend
the stamp-transactions reason enum.

**Architecture:** Three sequential migrations under
`netlify/database/migrations/`. Each migration is its own directory
containing `migration.sql` (and `down.sql` matching the rest of the
project's convention). Migration 0010 is destructive (pre-release
reset). Migrations 0011 and 0012 are additive.

**Tech Stack:** PostgreSQL (Neon via `@netlify/database`). No
TypeScript in this phase — pure SQL migrations.

**Scope:** 1 of 8 phases.

**Codebase verified:** 2026-05-17

---

## Codebase Investigation Findings

The investigator confirmed several deltas from the design plan that
this phase must accommodate:

- **Migration directory layout is `netlify/database/migrations/NNNN_name/migration.sql`**,
  NOT bare `netlify/migrations/NNNN_name.sql` as the design plan
  states. Each migration is its own directory containing
  `migration.sql` and `down.sql`. Highest existing number is `0009`.
- **`users.email_verified_at` does NOT exist** in the current schema.
  The design says to drop it "(if present)" — use `DROP COLUMN IF EXISTS`.
- **`users.subscription_current_period_end` DOES exist** — added by
  migration `0002_account_management`. The design correctly identifies
  this column.
- **`email_change_requests` table does NOT exist.** The codebase uses
  `magic_link_tokens` with `purpose` and `pending_email` columns
  (added later by 0002) for email change. Just drop `magic_link_tokens`
  entirely.
- **Append-only trigger pattern from `0007_stamp_transactions_append_only/migration.sql`**
  uses a per-table function name (`reject_stamp_tx_mutation`). For
  `share_events`, use a separate function `reject_share_events_mutation`
  to keep error messages accurate and avoid coupling.
- **User-scoped tables that need truncation:** `users`, `passkeys`,
  `magic_link_tokens`, `drawings`, `public_posts`, `stamp_lots`,
  `stamp_transactions`, `stamp_invariant_alerts`, `autumn_refund_attempts`,
  `postcards`, `pending_gifts`, `sent_gifts`. With `TRUNCATE users
  RESTART IDENTITY CASCADE` the cascading FKs do most of the work; but
  the design intent is to wipe everything, so be explicit and TRUNCATE
  every table that depends on `users` directly or transitively.
- `stamp_transactions.reason` CHECK constraint currently allows:
  `'purchase'`, `'grant'`, `'migration_grant'`, `'send'`, `'refund'`,
  `'gift_sent'`, `'gift_received'`, `'failed_send_refund'`. Phase 1
  extends this with `'share'`.

---

## Acceptance Criteria Coverage

This phase produces the database substrate that later phases consume.
No application code runs against these migrations in this phase, so
the ACs verified here are exclusively schema-shape facts (no behavior
tests). Behavioral ACs are covered when the application code that uses
these tables lands in later phases.

### share-quota.AC2: Subscription model is fully removed
- **share-quota.AC2.2 Success:** `users` rows have no
  `subscription_status` or `subscription_current_period_end` columns;
  `SessionUser` and `AccountDetails` do not expose them.
  *(Schema half: this phase drops the columns. Type half: Phase 2.)*

### share-quota.AC4: Quota accounting is correct
- **share-quota.AC4.1 Success:** First confirmed share of a user's
  calendar month (in their browser TZ) writes a `share_events` row
  with `was_free = true` and no `stamp_transactions` row.
  *(Schema substrate: this phase creates `share_events` with the
  `was_free` column and the partial index that the read query needs.
  Behavior: Phase 5.)*
- **share-quota.AC4.2 Success:** Subsequent confirmed share in the
  same month writes a `share_events` row with `was_free = false` AND
  a `stamp_transactions` row with `reason = 'share'`, `delta = -1`,
  and `reference_id = share_events.id`.
  *(Schema substrate: this phase extends the `reason` CHECK to allow
  `'share'`. Behavior: Phase 5.)*
- **share-quota.AC4.6 Failure:** A `confirm` request with an
  `idempotency_key` that was already used for a different `drawing_id`
  returns 409.
  *(Schema substrate: this phase creates the `UNIQUE (user_id,
  idempotency_key)` constraint that the 409 check leans on. Behavior:
  Phase 5.)*

---

## Tasks

<!-- START_TASK_1 -->
### Task 1: Migration 0010 — Pre-release reset for atproto

**Files:**
- Create: `/Users/nick/code/drerings/netlify/database/migrations/0010_pre_release_reset_for_atproto/migration.sql`
- Create: `/Users/nick/code/drerings/netlify/database/migrations/0010_pre_release_reset_for_atproto/down.sql`

**Step 1: Create the migration directory**

```bash
mkdir -p /Users/nick/code/drerings/netlify/database/migrations/0010_pre_release_reset_for_atproto
```

**Step 2: Write `migration.sql`**

Use Write tool to create
`/Users/nick/code/drerings/netlify/database/migrations/0010_pre_release_reset_for_atproto/migration.sql`
with this exact content:

```sql
-- 0010_pre_release_reset_for_atproto
-- Pre-release destructive reset: replace email/passkey identity with
-- Bluesky DID-keyed users. Truncates all user-scoped data, drops the
-- email/subscription columns, drops the obsolete auth tables, and adds
-- the DID/handle columns the new auth layer requires.
--
-- This is acceptable only because the app is pre-release. After
-- release, replace any equivalent change with a forward migration that
-- preserves existing rows.

BEGIN;

-- ---------------------------------------------------------------
-- Truncate all user-scoped tables.
-- TRUNCATE bypasses the append-only triggers on stamp_transactions
-- (the trigger only fires on UPDATE/DELETE, not TRUNCATE — see the
-- comment at the top of migration 0007).
-- ---------------------------------------------------------------
TRUNCATE TABLE
    autumn_refund_attempts,
    stamp_invariant_alerts,
    stamp_transactions,
    stamp_lots,
    postcards,
    sent_gifts,
    pending_gifts,
    public_posts,
    drawings,
    magic_link_tokens,
    passkeys,
    users
RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------
-- Drop the obsolete auth tables. The new auth path uses Bluesky
-- OAuth (atproto), so passkeys and magic links are gone.
-- ---------------------------------------------------------------
DROP TABLE IF EXISTS passkeys;
DROP TABLE IF EXISTS magic_link_tokens;

-- ---------------------------------------------------------------
-- Drop the email/subscription columns on users. The subscription tier
-- is removed entirely; identity moves to DID.
-- ---------------------------------------------------------------
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_subscription_status_check;

ALTER TABLE users
    DROP COLUMN IF EXISTS subscription_status,
    DROP COLUMN IF EXISTS subscription_current_period_end,
    DROP COLUMN IF EXISTS email_verified_at,
    DROP COLUMN IF EXISTS email;

-- ---------------------------------------------------------------
-- Add the DID-keyed identity columns. did is the new primary
-- per-user identifier (one row per Bluesky DID). handle is the
-- current handle for display; it can change over time on Bluesky's
-- side without affecting the DID.
-- ---------------------------------------------------------------
ALTER TABLE users
    ADD COLUMN did TEXT NOT NULL,
    ADD COLUMN handle TEXT NOT NULL,
    ADD COLUMN handle_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE users
    ADD CONSTRAINT users_did_unique UNIQUE (did);

CREATE INDEX users_handle_idx ON users (handle);

COMMIT;
```

**Step 3: Write `down.sql`**

Use Write tool to create
`/Users/nick/code/drerings/netlify/database/migrations/0010_pre_release_reset_for_atproto/down.sql`
with this exact content:

```sql
-- Down migration for 0010_pre_release_reset_for_atproto.
-- This is a best-effort revert; truncated user data cannot be restored.
-- The schema can be restored to its prior shape.

BEGIN;

DROP INDEX IF EXISTS users_handle_idx;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_did_unique;

ALTER TABLE users
    DROP COLUMN IF EXISTS handle_updated_at,
    DROP COLUMN IF EXISTS handle,
    DROP COLUMN IF EXISTS did;

ALTER TABLE users
    ADD COLUMN email TEXT,
    ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'free',
    ADD COLUMN subscription_current_period_end DATE;

ALTER TABLE users
    ADD CONSTRAINT users_subscription_status_check CHECK (
        subscription_status IN (
            'free',
            'active',
            'canceled',
            'past_due'
        )
    );

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);

CREATE TABLE IF NOT EXISTS passkeys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id text NOT NULL UNIQUE,
    public_key text NOT NULL,
    counter bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS magic_link_tokens (
    token text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz
);

COMMIT;
```

Note: `down.sql` is a best-effort schema revert. Data is destroyed by
the truncate in `migration.sql` and cannot be recovered.

**Step 4: Apply against the local Neon dev branch**

Run the project's existing migration application command. Look in
`README.md` and `package.json` for the exact command; the conventional
choice on this stack is `npx netlify dev`-driven auto-application or a
manual `psql` apply. If unclear, run:

```bash
ls /Users/nick/code/drerings/netlify/database/
```

to confirm there is no migration-runner script the project uses, then
follow whatever README says. **Do NOT invent a runner.** If you cannot
find the project's migration application method, STOP and surface the
question.

Expected: `migration.sql` applies cleanly against a fresh database
with no errors. (On a database that has data, this is destructive —
intentionally.)

**Step 5: Verification**

After applying the migration, the schema must reflect these facts.
Verify each with a psql query against the dev database:

```sql
-- Confirm new columns exist
\d users
-- Expected output includes: did text NOT NULL, handle text NOT NULL,
--   handle_updated_at timestamptz NOT NULL DEFAULT now()
-- Expected output does NOT include: email, subscription_status,
--   subscription_current_period_end

-- Confirm old tables are gone
\dt passkeys
-- Expected: relation does not exist

\dt magic_link_tokens
-- Expected: relation does not exist

-- Confirm UNIQUE constraint on did
SELECT conname
FROM pg_constraint
WHERE conrelid = 'users'::regclass AND contype = 'u';
-- Expected: row with conname='users_did_unique'
```

**Step 6: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/database/migrations/0010_pre_release_reset_for_atproto/
git commit -m "$(cat <<'EOF'
feat(db): migration 0010 - pre-release reset for atproto

Replaces email/passkey identity with DID-keyed users. Truncates all
user-scoped tables, drops the email and subscription columns, drops
the passkeys and magic_link_tokens tables, and adds did/handle/
handle_updated_at columns. This is destructive and only acceptable
pre-release.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Migration 0011 — share_events table

**Files:**
- Create: `/Users/nick/code/drerings/netlify/database/migrations/0011_share_events/migration.sql`
- Create: `/Users/nick/code/drerings/netlify/database/migrations/0011_share_events/down.sql`

**Step 1: Create the migration directory**

```bash
mkdir -p /Users/nick/code/drerings/netlify/database/migrations/0011_share_events
```

**Step 2: Write `migration.sql`**

Use Write tool to create
`/Users/nick/code/drerings/netlify/database/migrations/0011_share_events/migration.sql`
with this exact content:

```sql
-- 0011_share_events
-- Records every share action. Mirrors postcards as the domain table for
-- the business event; paid-share linkage lives on stamp_transactions
-- via stamp_transactions.reference_id = share_events.id (same pattern
-- postcards uses). Append-only at the DB layer via BEFORE UPDATE /
-- BEFORE DELETE triggers, identical in shape to the triggers in
-- migration 0007 on stamp_transactions.
--
-- month_key is the YYYY-MM string computed in the user's IANA
-- timezone at write time. The partial index supports the "has the
-- user used their free share this month?" lookup that recordShare
-- performs under a row-level lock.
--
-- idempotency_key is client-generated (UUID v4) and unique per user.
-- It serializes precheck/confirm retries into one share row.

BEGIN;

CREATE TABLE share_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    drawing_id UUID NOT NULL REFERENCES drawings(id),
    month_key TEXT NOT NULL,
    timezone TEXT NOT NULL,
    was_free BOOLEAN NOT NULL,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT share_events_user_idem_unique
        UNIQUE (user_id, idempotency_key)
);

CREATE INDEX share_events_user_free_month_idx
    ON share_events (user_id, month_key)
    WHERE was_free = true;

-- Append-only triggers (modeled on migration 0007). A dedicated
-- function keeps the exception message accurate for this table.
CREATE OR REPLACE FUNCTION reject_share_events_mutation ()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'share_events is append-only (attempted %)',
        TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER share_events_no_update
    BEFORE UPDATE ON share_events
    FOR EACH ROW EXECUTE FUNCTION reject_share_events_mutation();

CREATE TRIGGER share_events_no_delete
    BEFORE DELETE ON share_events
    FOR EACH ROW EXECUTE FUNCTION reject_share_events_mutation();

COMMIT;
```

**Step 3: Write `down.sql`**

Use Write tool to create
`/Users/nick/code/drerings/netlify/database/migrations/0011_share_events/down.sql`
with this exact content:

```sql
-- Down migration for 0011_share_events.
BEGIN;

DROP TRIGGER IF EXISTS share_events_no_delete ON share_events;
DROP TRIGGER IF EXISTS share_events_no_update ON share_events;
DROP FUNCTION IF EXISTS reject_share_events_mutation;
DROP INDEX IF EXISTS share_events_user_free_month_idx;
DROP TABLE IF EXISTS share_events;

COMMIT;
```

**Step 4: Apply the migration**

Same command as Task 1, step 4.

Expected: applies cleanly.

**Step 5: Verification**

```sql
\d share_events
-- Expected columns: id, user_id, drawing_id, month_key, timezone,
--   was_free, idempotency_key, created_at
-- Expected constraints: share_events_user_idem_unique on
--   (user_id, idempotency_key)

\di share_events_user_free_month_idx
-- Expected: partial index, condition: was_free = true

-- Confirm triggers
SELECT tgname
FROM pg_trigger
WHERE tgrelid = 'share_events'::regclass AND NOT tgisinternal;
-- Expected: share_events_no_update, share_events_no_delete

-- Confirm triggers actually reject mutations
INSERT INTO share_events (user_id, drawing_id, month_key, timezone,
                          was_free, idempotency_key)
SELECT id, gen_random_uuid(), '2026-05', 'UTC', true,
       'test-idem-key-' || gen_random_uuid()
FROM users LIMIT 1
RETURNING id;
-- (Capture the returned id, e.g. as :sid)
UPDATE share_events SET was_free = false WHERE id = :'sid';
-- Expected: ERROR: share_events is append-only (attempted UPDATE)
DELETE FROM share_events WHERE id = :'sid';
-- Expected: ERROR: share_events is append-only (attempted DELETE)
-- Clean up the test row by TRUNCATE (which bypasses triggers).
TRUNCATE share_events;
```

**Step 6: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/database/migrations/0011_share_events/
git commit -m "$(cat <<'EOF'
feat(db): migration 0011 - share_events table

Append-only domain table for share actions. Partial index on
(user_id, month_key) WHERE was_free = true supports the "has the user
used their free share this month?" lookup. Append-only triggers mirror
stamp_transactions (migration 0007).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Migration 0012 — Extend stamp_transactions.reason

**Files:**
- Create: `/Users/nick/code/drerings/netlify/database/migrations/0012_stamp_tx_share_reason/migration.sql`
- Create: `/Users/nick/code/drerings/netlify/database/migrations/0012_stamp_tx_share_reason/down.sql`

**Step 1: Create the migration directory**

```bash
mkdir -p /Users/nick/code/drerings/netlify/database/migrations/0012_stamp_tx_share_reason
```

**Step 2: Inspect the current `reason` CHECK constraint**

Before writing the migration, confirm the constraint name and the
exact list of currently-allowed values. Run:

```bash
grep -n "reason" /Users/nick/code/drerings/netlify/database/migrations/0003_stamp_accounting/migration.sql
```

The constraint will be named something like
`stamp_transactions_reason_check` (the default PostgreSQL name for
a column-level CHECK). Capture the actual name and the full value
list. Adjust step 3 to match — do not invent a constraint name.

**Step 3: Write `migration.sql`**

Use Write tool to create
`/Users/nick/code/drerings/netlify/database/migrations/0012_stamp_tx_share_reason/migration.sql`
with this exact content. **Verify the constraint name and value list
against the output of step 2 before applying — if the existing
constraint has a different name or different values, edit this
migration to match.**

```sql
-- 0012_stamp_tx_share_reason
-- Extend stamp_transactions.reason to allow 'share'. The paid-share
-- path in recordShare (Phase 5) inserts a stamp_transactions row with
-- reason='share' and reference_id pointing at the share_events row.
--
-- We rebuild the CHECK constraint because PostgreSQL has no
-- ALTER CHECK CONSTRAINT (it's drop-and-recreate). The existing values
-- come from migration 0003.

BEGIN;

ALTER TABLE stamp_transactions
    DROP CONSTRAINT stamp_transactions_reason_check;

ALTER TABLE stamp_transactions
    ADD CONSTRAINT stamp_transactions_reason_check CHECK (
        reason IN (
            'purchase',
            'grant',
            'migration_grant',
            'send',
            'refund',
            'gift_sent',
            'gift_received',
            'failed_send_refund',
            'share'
        )
    );

COMMIT;
```

**Step 4: Write `down.sql`**

Use Write tool to create
`/Users/nick/code/drerings/netlify/database/migrations/0012_stamp_tx_share_reason/down.sql`
with this exact content:

```sql
-- Down migration for 0012_stamp_tx_share_reason.
-- Drops 'share' from the allowed values. Any existing 'share' rows
-- in stamp_transactions will block this — they would have to be
-- handled (manually) before downgrading.
BEGIN;

ALTER TABLE stamp_transactions
    DROP CONSTRAINT stamp_transactions_reason_check;

ALTER TABLE stamp_transactions
    ADD CONSTRAINT stamp_transactions_reason_check CHECK (
        reason IN (
            'purchase',
            'grant',
            'migration_grant',
            'send',
            'refund',
            'gift_sent',
            'gift_received',
            'failed_send_refund'
        )
    );

COMMIT;
```

**Step 5: Apply the migration and verify**

Same application command as previous tasks.

```sql
-- Confirm 'share' is allowed
INSERT INTO stamp_transactions (
    user_id, lot_id, reason, delta, reference_id
)
SELECT u.id, l.id, 'share', -1, gen_random_uuid()
FROM users u, stamp_lots l
WHERE l.user_id = u.id
LIMIT 1;
-- Expected: insert succeeds.

-- Confirm 'bogus' is still rejected
INSERT INTO stamp_transactions (
    user_id, lot_id, reason, delta, reference_id
)
SELECT u.id, l.id, 'bogus', -1, gen_random_uuid()
FROM users u, stamp_lots l
WHERE l.user_id = u.id
LIMIT 1;
-- Expected: ERROR: new row for relation "stamp_transactions" violates
-- check constraint "stamp_transactions_reason_check"

-- Clean up the test row (TRUNCATE bypasses append-only triggers).
TRUNCATE stamp_transactions;
```

If the existing test data was important, restore it from a backup —
TRUNCATE wipes it. Since we're operating against a fresh database
post-migration-0010, this is fine.

**Step 6: Commit**

```bash
cd /Users/nick/code/drerings
git add netlify/database/migrations/0012_stamp_tx_share_reason/
git commit -m "$(cat <<'EOF'
feat(db): migration 0012 - allow 'share' in stamp_transactions.reason

Rebuilds the reason CHECK constraint to include 'share' for the new
paid-share path. Paid shares record a stamp_transactions row with
reason='share' and reference_id pointing at the share_events row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Lint pass

**Step 1: Run lint**

```bash
cd /Users/nick/code/drerings
npm run lint
```

**Expected:** Exit code 0, no errors. (SQL files are not linted, but
any incidental TypeScript edits in this phase would be caught here —
this phase touches no TS, so this is a sanity check that the project
still lints clean.)

**Step 2: Run tests**

```bash
cd /Users/nick/code/drerings
npm test
```

**Expected:** Test suite runs. Many existing tests will fail because
the schema has changed (passkeys gone, magic_link_tokens gone, email
column gone, subscription columns gone). **That's expected** — Phase 2
removes the corresponding application code and Phase 8 cleans up the
tests. For this phase, simply confirm: no test failure is caused by a
SQL-syntax problem in the migrations themselves. The failures should
look like type errors and missing tables in app code paths, not like
"could not apply migration".

If a failure looks migration-related, fix the migration. Otherwise,
move on — those failures are addressed in later phases.

**Step 3: Commit**

If no edits were needed in steps 1–2, nothing to commit. If you fixed
a migration in response to a real issue, amend the affected migration's
commit (or, per house style, create a new follow-up commit).

```bash
cd /Users/nick/code/drerings
git status
```

Expected: clean working tree.
<!-- END_TASK_4 -->

---

## Done When

- Migrations 0010, 0011, 0012 each apply cleanly against a fresh test
  database (no SQL errors).
- The `users` table has `did UNIQUE NOT NULL`, `handle NOT NULL`,
  `handle_updated_at NOT NULL DEFAULT now()`; and does not have
  `email`, `subscription_status`, or `subscription_current_period_end`.
- The `passkeys` and `magic_link_tokens` tables are dropped.
- The `share_events` table exists with the partial index and the
  append-only triggers; `UPDATE` and `DELETE` against it raise an
  exception.
- `stamp_transactions.reason` accepts `'share'` and rejects unknown
  values.
- `npm run lint` exits 0.
