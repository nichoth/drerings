DROP TRIGGER IF EXISTS stamp_tx_no_delete ON stamp_transactions;
DROP TRIGGER IF EXISTS stamp_tx_no_update ON stamp_transactions;
DROP FUNCTION IF EXISTS reject_stamp_tx_mutation();
