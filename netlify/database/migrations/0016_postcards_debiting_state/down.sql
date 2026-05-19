-- Reverts 0016. Any rows currently in 'debiting' must be resolved
-- (manually rolled forward to 'sent' or 'failed_refunded') before
-- this down migration can apply, otherwise the new CHECK fails.

BEGIN;

ALTER TABLE postcards
    DROP CONSTRAINT postcards_status_check;

ALTER TABLE postcards
    ADD CONSTRAINT postcards_status_check
    CHECK (status IN ('queued', 'sent', 'failed_refunded'));

COMMIT;
