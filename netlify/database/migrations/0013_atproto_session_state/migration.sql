-- 0013_atproto_session_state
-- Backing storage for @atproto/oauth-client-node's SessionStore and
-- StateStore. SessionStore is keyed by the user's DID (the OAuth
-- 'sub'). StateStore is keyed by the random state value generated at
-- the start of each OAuth flow. Both store opaque JSON blobs the
-- library writes; we do not interpret the contents.

BEGIN;

CREATE TABLE atproto_sessions (
    sub TEXT PRIMARY KEY,
    session_data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE atproto_oauth_states (
    state TEXT PRIMARY KEY,
    state_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- State entries live only for the duration of the OAuth dance (PAR
-- → user authenticates → callback). 15-minute TTL is sufficient. The
-- callback explicitly deletes them; this index supports a future
-- janitor job.
CREATE INDEX atproto_oauth_states_created_at_idx
    ON atproto_oauth_states (created_at);

COMMIT;
