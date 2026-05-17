-- stamp_transactions is the audit ledger for the stamps feature.
-- Design invariant (docs/pricing.md line 95):
--   "stamp_transactions is append-only — no updates or deletes, ever."
--
-- These triggers move that invariant from application discipline to a
-- database guarantee. Note: this does NOT block TRUNCATE; test fixtures
-- may legitimately TRUNCATE during setUp. Production code paths never
-- should.
--
-- Refunds are recorded as NEW rows with reason='failed_send_refund' or
-- 'refund' or 'gift_reclaimed', not by mutating the original debit row.

CREATE OR REPLACE FUNCTION reject_stamp_tx_mutation ()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'stamp_transactions is append-only (attempted %)',
        TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stamp_tx_no_update
    BEFORE UPDATE ON stamp_transactions
    FOR EACH ROW EXECUTE FUNCTION reject_stamp_tx_mutation();

CREATE TRIGGER stamp_tx_no_delete
    BEFORE DELETE ON stamp_transactions
    FOR EACH ROW EXECUTE FUNCTION reject_stamp_tx_mutation();
