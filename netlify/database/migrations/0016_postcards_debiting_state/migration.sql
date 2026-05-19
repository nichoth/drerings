-- 0016_postcards_debiting_state
-- Adds a 'debiting' state to postcards.status. Used by the send handler
-- to atomically claim a postcard for debit via CAS:
--   UPDATE postcards SET status='debiting'
--   WHERE id=$1 AND status='queued' RETURNING id
--
-- This closes the 10-minute "resurrection" double-debit window: a retry
-- that arrives while the original send is still in flight will fail the
-- CAS and return 409 send_in_progress instead of running a second debit
-- on the same postcard.id.
--
-- The 'debiting' state is transient. Successful sends transition
-- 'debiting' -> 'sent' via attachLotAndMarkSent. Failed sends transition
-- 'debiting' -> 'failed_refunded' via markFailedRefunded.

BEGIN;

ALTER TABLE postcards
    DROP CONSTRAINT postcards_status_check;

ALTER TABLE postcards
    ADD CONSTRAINT postcards_status_check
    CHECK (status IN ('queued', 'debiting', 'sent', 'failed_refunded'));

COMMIT;
