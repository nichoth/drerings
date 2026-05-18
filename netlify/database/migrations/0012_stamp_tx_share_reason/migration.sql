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
            'gift_reclaimed',
            'failed_send_refund',
            'share'
        )
    );

COMMIT;
