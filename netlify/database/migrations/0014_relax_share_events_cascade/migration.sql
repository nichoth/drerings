-- 0014_relax_share_events_cascade
-- Drop the BEFORE DELETE trigger on share_events to allow CASCADE
-- deletes from deleteAccountData. The BEFORE UPDATE trigger remains
-- to enforce append-only semantics on the UPDATE path, which is the
-- intended design (share_events records are immutable; they can only
-- be deleted by CASCADE).

BEGIN;

DROP TRIGGER share_events_no_delete ON share_events;

COMMIT;
