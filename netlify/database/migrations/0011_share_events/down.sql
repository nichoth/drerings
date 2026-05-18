-- Down migration for 0011_share_events.
BEGIN;

DROP TRIGGER IF EXISTS share_events_no_delete ON share_events;
DROP TRIGGER IF EXISTS share_events_no_update ON share_events;
DROP FUNCTION IF EXISTS reject_share_events_mutation;
DROP INDEX IF EXISTS share_events_user_free_month_idx;
DROP TABLE IF EXISTS share_events;

COMMIT;
