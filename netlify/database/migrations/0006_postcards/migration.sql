CREATE TABLE postcards (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id       uuid NOT NULL REFERENCES users(id)
                        ON DELETE CASCADE,
    drawing_id      uuid NOT NULL REFERENCES drawings(id)
                        ON DELETE CASCADE,
    recipient_email text NOT NULL,
    lot_id          uuid REFERENCES stamp_lots(id)
                        ON DELETE SET NULL,
    resend_email_id text,
    status          text NOT NULL CHECK (status IN (
        'queued', 'sent', 'failed_refunded'
    )),
    idempotency_key text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_postcards_idempotency
    ON postcards(sender_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_postcards_resend
    ON postcards(resend_email_id)
    WHERE resend_email_id IS NOT NULL;
