-- Forensic log of every call to Autumn's refund endpoint. Survives the
-- caller's transaction (written via an independent connection) so that
-- if the local COMMIT fails after Autumn has already refunded, the
-- operator can compare ledger entries against attempt rows and find
-- the orphan.
--
-- The (checkout_id, amount_cents) pair acts as the natural idempotency
-- key: a particular lot with a particular remaining_count can only be
-- refunded once. The unique index lets Task 5's lookup return early on
-- a retry without re-calling Autumn.

CREATE TABLE autumn_refund_attempts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    checkout_id     text NOT NULL,
    amount_cents    integer NOT NULL CHECK (amount_cents > 0),
    request_id      text NOT NULL,        -- "${checkout_id}:${amount_cents}"
    status          text NOT NULL CHECK (status IN (
        'attempted', 'succeeded', 'failed'
    )),
    http_status     integer,
    response_body   text,                  -- truncated to 2KB at write time
    error_message   text,                  -- network error, if any
    attempted_at    timestamptz NOT NULL DEFAULT now(),
    responded_at    timestamptz
);

CREATE UNIQUE INDEX idx_autumn_refund_attempts_request
    ON autumn_refund_attempts(request_id);

-- For the operator dashboard: "show me everything that failed":
CREATE INDEX idx_autumn_refund_attempts_status
    ON autumn_refund_attempts(status, attempted_at DESC)
    WHERE status = 'failed';
