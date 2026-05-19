-- 0015_stamp_lots_checkout_unique
-- Prevents double-credit on Autumn webhook retries. Without this, two
-- concurrent deliveries of the same checkout.completed event can both
-- pass the advisory hasStampCheckout() check and both credit the user.
--
-- The partial index applies only to purchase and gift_received lots that
-- carry an autumn_checkout_id. Grants (source='grant') have a NULL
-- autumn_checkout_id and are unaffected — migration_grant fixtures and
-- the signup grant remain insertable.
--
-- Postgres surfaces a 23505 (unique_violation) on the second concurrent
-- INSERT. The caller in netlify/lib/stamps.ts catches it and raises a
-- typed DuplicateStampCheckoutError, which applyStampCheckout maps to
-- the existing 'already_credited' webhook outcome.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stamp_lots_autumn_checkout_purchase
    ON stamp_lots (autumn_checkout_id)
    WHERE source IN ('purchase', 'gift_received')
        AND autumn_checkout_id IS NOT NULL;

COMMIT;
