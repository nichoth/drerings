-- 0014_relax_share_events_cascade (down)
-- Restore the BEFORE DELETE trigger on share_events.

BEGIN;

CREATE TRIGGER share_events_no_delete
    BEFORE DELETE ON share_events
    FOR EACH ROW EXECUTE FUNCTION reject_share_events_mutation();

COMMIT;
