-- Down migration for 0012_stamp_tx_share_reason.
-- Drops 'share' from the allowed values. Any existing 'share' rows
-- in stamp_transactions will block this — they would have to be
-- handled (manually) before downgrading.
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
            'failed_send_refund'
        )
    );

COMMIT;
