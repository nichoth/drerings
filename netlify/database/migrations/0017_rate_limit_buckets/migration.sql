-- 0017_rate_limit_buckets
-- Fixed-window token-bucket store for per-endpoint rate limiting.
--
-- Each row tracks one logical bucket. The key is composed by callers
-- as either:
--   user:{user_id}:{endpoint}
--   ip:{ip_addr}:{endpoint}
--
-- Buckets are not actively pruned. A periodic vacuum/cleanup job MAY
-- delete rows with stale window_start (e.g. older than 24h) but is not
-- required for correctness — stale rows simply roll their window on
-- next access.

BEGIN;

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    key             TEXT PRIMARY KEY,
    window_start    TIMESTAMPTZ NOT NULL DEFAULT now(),
    count           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_window_start
    ON rate_limit_buckets(window_start);

COMMIT;
