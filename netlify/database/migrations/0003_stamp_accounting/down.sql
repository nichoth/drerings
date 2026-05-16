DROP TABLE IF EXISTS stamp_transactions;

DROP TABLE IF EXISTS stamp_lots;

ALTER TABLE users
    DROP COLUMN IF EXISTS stamps_balance;
