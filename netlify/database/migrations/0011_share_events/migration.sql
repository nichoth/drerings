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
