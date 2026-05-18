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
