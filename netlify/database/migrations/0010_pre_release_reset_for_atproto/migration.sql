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
