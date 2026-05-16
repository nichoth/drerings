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
            'failed_send_refund'
        )
    );
