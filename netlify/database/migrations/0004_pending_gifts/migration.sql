CREATE TABLE pending_gifts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_email text NOT NULL,
    pack_id text NOT NULL,
    count integer NOT NULL,
    price_cents integer NOT NULL,
    autumn_checkout_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'pending',
    CONSTRAINT pending_gifts_count_check CHECK (count > 0),
    CONSTRAINT pending_gifts_price_check CHECK (price_cents >= 0),
    CONSTRAINT pending_gifts_status_check CHECK (
        status IN ('pending', 'claimed', 'refunded')
    )
);

CREATE UNIQUE INDEX idx_pending_gifts_checkout
    ON pending_gifts(autumn_checkout_id);

CREATE INDEX idx_pending_gifts_sender_status
    ON pending_gifts(sender_user_id, status, created_at DESC);
