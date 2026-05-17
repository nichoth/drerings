-- Durable record of stamp invariant drifts detected by the scheduled
-- verifyStampInvariants() job. Operators query this table instead of
-- scrolling through Netlify function logs (which expire by retention
-- policy). One row per (user, invariant) drift event.

-- user_id is uuid to match users.id (see 0001_paid_accounts_schema:4 —
-- every user reference in this schema is uuid, never text).
CREATE TABLE stamp_invariant_alerts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invariant       text NOT NULL,
        -- identifier from verifyStampInvariants
    expected        bigint NOT NULL,
    actual          bigint NOT NULL,
    detected_at     timestamptz NOT NULL DEFAULT now(),
    resolved_at     timestamptz,
        -- NULL while the drift is active
    resolution_note text
        -- operator's note when marking resolved
);

-- Active alerts are the queryable working set. A new drift for the same
-- (user, invariant) is suppressed while the previous one is still open.
CREATE UNIQUE INDEX idx_alerts_active_unique
    ON stamp_invariant_alerts(user_id, invariant)
    WHERE resolved_at IS NULL;

-- For the operator dashboard query: "show me everything open right now".
CREATE INDEX idx_alerts_active_recent
    ON stamp_invariant_alerts(detected_at DESC)
    WHERE resolved_at IS NULL;
