ALTER TABLE users
    ADD COLUMN stamps_balance integer NOT NULL DEFAULT 0;

CREATE TABLE stamp_lots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source text NOT NULL,
    original_count integer NOT NULL,
    remaining_count integer NOT NULL,
    price_paid_cents integer,
    autumn_checkout_id text,
    gifted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT stamp_lots_source_check CHECK (
        source IN ('purchase', 'grant', 'gift_received')
    ),
    CONSTRAINT stamp_lots_original_count_check CHECK (
        original_count > 0
    ),
    CONSTRAINT stamp_lots_remaining_nonnegative_check CHECK (
        remaining_count >= 0
    ),
    CONSTRAINT stamp_lots_remaining_original_check CHECK (
        remaining_count <= original_count
    )
);

CREATE INDEX idx_lots_consumption
    ON stamp_lots(user_id, source, created_at)
    WHERE remaining_count > 0;

CREATE TABLE stamp_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lot_id uuid REFERENCES stamp_lots(id) ON DELETE SET NULL,
    delta integer NOT NULL,
    reason text NOT NULL,
    reference_id text,
    balance_after integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT stamp_transactions_reason_check CHECK (
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
    )
);

CREATE INDEX idx_stamp_tx_user_created
    ON stamp_transactions(user_id, created_at DESC);
