-- gen_random_uuid() is in Postgres core since 13, no extension needed.
-- Removed `CREATE EXTENSION pgcrypto` so CLI 26's local PGlite (no
-- contrib extensions) can apply this migration; real Neon ships
-- pgcrypto pre-installed, so production is unaffected.

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    subscription_status text NOT NULL DEFAULT 'free',
    autumn_customer_id text,
    CONSTRAINT users_subscription_status_check CHECK (
        subscription_status IN (
            'free',
            'active',
            'canceled',
            'past_due'
        )
    )
);

CREATE TABLE passkeys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id text NOT NULL UNIQUE,
    public_key text NOT NULL,
    counter bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE magic_link_tokens (
    token text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz
);

CREATE TABLE drawings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blob_key text NOT NULL,
    text text NOT NULL,
    alt_text text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public_posts (
    id bigserial PRIMARY KEY,
    drawing_id uuid NOT NULL UNIQUE REFERENCES drawings(id) ON DELETE CASCADE,
    published_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX passkeys_user_id_idx ON passkeys(user_id);

CREATE INDEX magic_link_tokens_user_id_idx ON magic_link_tokens(user_id);

CREATE INDEX drawings_user_id_updated_at_idx
    ON drawings(user_id, updated_at DESC);
