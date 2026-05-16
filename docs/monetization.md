# Drerings Stamps: Design Document

**Status:** Draft
**Author:** Nichoth
**Last updated:** May 15, 2026

## Summary

Drerings will monetize via **prepaid "stamps"** — a one-time-purchase credit system where one stamp is consumed per postcard sent to a recipient. Stamps never expire, are refundable on a prorated basis, and can be gifted between users. Failed sends do not consume a stamp. Posts to Bluesky are free and unmetered, since they serve as an acquisition channel rather than a paid feature.

This document specifies the data model, transaction semantics, pricing, edge cases, and rollout plan.

## Goals

- Charge a small per-postcard price (target effective ~$0.30–$0.50/stamp) without paying credit card fees on every send.
- Preserve the "postcard, not megaphone" product framing: paid behavior is the 1:1 send; broadcast to Bluesky stays free.
- Avoid friction at the moment of sending — no payment modal mid-flow.
- Give every new user a real taste of the product before being asked to pay.
- Keep refunds, gifting, and dispute resolution operationally simple.

## Non-goals

- Subscription pricing. A monthly plan may be layered in later, but the v1 model is prepaid credits only.
- Cross-currency pricing. USD only at launch.
- Stamp expiry. Stamps are perpetual.
- Charging for receiving postcards. Receiving is always free.

## Background

Drerings is a drawing app where users draw on a canvas and send the image as a private "postcard" to a recipient. The product also supports posting publicly to Bluesky via AT Protocol. The current stack is Netlify Functions + Netlify Database (Postgres) + Netlify Blobs (PNG storage) + Resend (transactional email) + Autumn (billing/Stripe abstraction). Autumn is already wired up for subscription billing; this design extends it for one-time stamp pack purchases.

The fundamental constraint motivating this design: Stripe's US fee structure is 2.9% + $0.30 per transaction. On a $0.50 charge, fees would consume 62% of revenue. Per-postcard charging at the moment of send is therefore economically infeasible unless transactions are aggregated. Stamps solve this by collapsing many small sends into a few larger payments.

## Pricing

Three pack tiers at launch:

| Pack | Stamps | Price | Per stamp |
|------|--------|-------|-----------|
| Starter | 10 | $5.00 | $0.50 |
| Bundle | 25 | $10.00 | $0.40 |
| Big bundle | 60 | $20.00 | $0.33 |

Rationale: the volume discount rewards heavy users and makes the Bundle look like the natural choice for someone past their first purchase. The Starter is intentionally not aggressively cheap — $0.50/stamp is still well under the cost of a physical postcard + USPS stamp, and the friction reinforces that each send is meaningful. We can revisit pricing after 60–90 days of real data.

**New user grant:** Every new account is granted **5 free stamps** at signup. This is the trial. Granted stamps are non-refundable and consumed before any paid stamps.

## Data model

### Schema changes

```sql
-- Denormalized fast-read balance on users
ALTER TABLE users ADD COLUMN stamps_balance INTEGER NOT NULL DEFAULT 0;

-- Each purchase, grant, or gift creates a "lot"
CREATE TABLE stamp_lots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  source TEXT NOT NULL,              -- 'purchase' | 'grant' | 'gift_received'
  original_count INTEGER NOT NULL,
  remaining_count INTEGER NOT NULL,
  price_paid_cents INTEGER,          -- NULL for non-purchase lots
  autumn_checkout_id TEXT,           -- for refund reference, NULL for non-purchase
  gifted_by_user_id TEXT REFERENCES users(id),  -- for gift_received lots
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (remaining_count >= 0),
  CHECK (remaining_count <= original_count)
);

CREATE INDEX idx_lots_consumption
  ON stamp_lots(user_id, source, created_at)
  WHERE remaining_count > 0;

-- Append-only event log of every credit/debit
CREATE TABLE stamp_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  lot_id TEXT REFERENCES stamp_lots(id),  -- which lot was affected (NULL for some edge cases)
  delta INTEGER NOT NULL,            -- positive for credit, negative for debit
  reason TEXT NOT NULL,              -- 'purchase' | 'grant' | 'send' | 'refund' | 'gift_sent' | 'gift_received' | 'failed_send_refund'
  reference_id TEXT,                 -- postcard_id for sends, autumn_checkout_id for purchases, etc.
  balance_after INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stamp_tx_user_created ON stamp_transactions(user_id, created_at DESC);
```

The lots table is the **source of truth** for per-unit accounting (which stamps came from which purchase, at what price). The `stamps_balance` column on `users` is a denormalized cache for fast reads. The `stamp_transactions` table is an append-only event log used for audit, support tickets, and analytics.

### Invariants

- `users.stamps_balance` == `SUM(stamp_lots.remaining_count) WHERE user_id = ...`
- `SUM(stamp_transactions.delta) WHERE user_id = ...` == `users.stamps_balance`
- `stamp_transactions` is append-only — no updates or deletes, ever.

A periodic background job should verify these invariants and alert on drift. The first time invariants drift in production, a human investigates before any automated reconciliation runs.

## Consumption order (FIFO with grants first)

When a user sends a postcard, the system selects which lot to debit:

1. Grants and gifts received first (in any order; they have no refundable cash basis).
2. Purchased lots in FIFO order (oldest first).

This rule maximizes the refundability of remaining paid stamps and matches user intuition that "free stamps go first."

```sql
UPDATE stamp_lots
SET remaining_count = remaining_count - 1
WHERE id = (
  SELECT id FROM stamp_lots
  WHERE user_id = $1 AND remaining_count > 0
  ORDER BY
    CASE source WHEN 'purchase' THEN 1 ELSE 0 END,  -- non-purchase first
    created_at ASC                                    -- then oldest first
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING id;
```

`FOR UPDATE SKIP LOCKED` handles concurrent sends correctly under Postgres: two simultaneous send requests on a balance of 1 will result in one success and one `InsufficientStampsError`, not a negative balance.

## Send flow

The order of operations is critical. A stamp is debited **before** the postcard is delivered, and refunded if delivery fails.

```
1. BEGIN transaction
2. Atomically debit one lot (query above). If no lot available → fail with InsufficientStampsError.
3. UPDATE users SET stamps_balance = stamps_balance - 1
     WHERE id = $userId AND stamps_balance > 0
     RETURNING stamps_balance;
   (Belt-and-suspenders; should always succeed if step 2 succeeded.)
4. INSERT a 'send' row into stamp_transactions with delta=-1, lot_id, balance_after.
5. COMMIT.

6. Attempt postcard delivery (write blob, send email via Resend).
7. If delivery succeeds: done.
8. If delivery fails (bounce, blob write error, etc.):
   a. BEGIN transaction
   b. UPDATE stamp_lots SET remaining_count = remaining_count + 1 WHERE id = $lotId
   c. UPDATE users SET stamps_balance = stamps_balance + 1 WHERE id = $userId
   d. INSERT a 'failed_send_refund' row in stamp_transactions with delta=+1, lot_id
   e. COMMIT
   f. Surface the failure to the sender with a clear message.
```

The debit-before-send order is deliberate. If we send first and debit second, a crash between the two leaves the user with a free send (revenue leak) and no audit trail. Debiting first means a crash leaves the user with a missing stamp and no postcard — which is recoverable via the refund path and visible in the ledger.

### What counts as a "failed send"?

- Recipient email hard-bounces (Resend returns a permanent failure).
- Blob write to Netlify Blobs fails after retries.
- The recipient address is malformed and rejected before sending.

What does **not** count as a failed send:

- The recipient never opens the email. (We delivered it; that's what they paid for.)
- The recipient marks it as spam. (Same — delivery succeeded.)
- The sender regrets sending it. (No refunds for "I changed my mind." We can revisit if this becomes a meaningful support burden.)

## Refunds

A user can request a refund of unused stamps from a specific purchased lot. The refund amount is calculated at the **per-stamp price they originally paid in that lot**:

```
refund_cents = (remaining_count_in_lot / original_count_in_lot) * price_paid_cents
             = remaining_count_in_lot * (price_paid_cents / original_count_in_lot)
```

Example: user bought the 25-pack for $10 ($0.40/stamp), used 10 stamps, requests refund. They get back 15 × $0.40 = **$6.00**. The remaining 15 stamps in that lot are zeroed out, and the refund is issued via Autumn/Stripe to the original payment method.

Granted stamps and gifted-received stamps are **never refundable for cash** — they had no cash basis to begin with. A refund request on a user with only granted/gifted stamps remaining is declined with a clear explanation.

If the user wants to refund multiple lots, each is processed independently against its own price basis.

### Refund flow

```
1. Validate: user owns the lot, lot.source = 'purchase', lot.remaining_count > 0.
2. Calculate refund_cents (formula above).
3. BEGIN transaction
4. UPDATE stamp_lots SET remaining_count = 0 WHERE id = $lotId
5. UPDATE users SET stamps_balance = stamps_balance - $refunded_count
6. INSERT a 'refund' row in stamp_transactions with delta=-$refunded_count
7. COMMIT
8. Call Autumn to issue refund of $refund_cents against the original autumn_checkout_id.
9. If Autumn refund fails: reverse the local state changes (or flag for manual reconciliation), surface the error.
```

The local state is updated before the external refund call so that a concurrent send during the refund process can't consume stamps that are about to be refunded. The trade-off is that an Autumn failure requires reversal; this is acceptable because Autumn refund failures are rare and visible.

Refund-related Stripe fees: per Stripe's policy, the original processing fee is not returned on refund. This is absorbed as a cost of doing business.

## Gifting

Two user-facing flows:

### Flow 1: Gift a pack to a specific recipient

The sender purchases a pack on behalf of a named recipient (by email or username). The full pack is credited to the recipient as a single `gift_received` lot. The sender's balance is unaffected.

Behaviorally similar to buying their own pack, except:
- The lot's `source` is `gift_received`.
- The lot's `gifted_by_user_id` records the sender.
- `price_paid_cents` is still recorded (the sender paid), but the lot is **not refundable by the recipient** — gifted stamps have no cash basis from the recipient's perspective. The sender retains refund rights on the unused portion for some window (proposed: 30 days from gift, before the recipient has used any of them). After that, or once the recipient uses any of the gifted stamps, the gift is final.

If the recipient doesn't yet have a Drerings account, the gift creates a pending invitation. Once the recipient signs up with that email, the lot is credited to their account. Pending gifts older than 90 days are refunded to the sender automatically.

### Flow 2: Gift individual stamps from an existing balance

Out of scope for v1. Possibly worth revisiting once we see whether pack-gifting is used at all. Pack-gifting is a marketing channel (it recruits a new user with a stamp balance); stamp-gifting between existing users is mostly a fairness mechanism and a lot more work to get right.

## Bluesky integration

Posts to Bluesky cost **zero stamps**. The "post to Bluesky" button remains prominent and friction-free.

Rationale:
- Public posts are a different product surface (broadcast, not 1:1). Charging for them muddies the postcard metaphor.
- Every Bluesky post is free marketing (a watermarked drawing with a link).
- Free users exhausted of stamps still have a meaningful action available, keeping them engaged.
- The pricing incentive aligns with positioning: paid behavior = the postcard behavior.

## Autumn integration

Three new one-time products in Autumn corresponding to the three pack tiers. Product IDs in the form `stamps_starter`, `stamps_bundle`, `stamps_big_bundle`. The Autumn webhook handler at `/api/billing/webhook` gets a new branch:

```ts
if (event.type === 'checkout.completed' && event.product_id.startsWith('stamps_')) {
  const pack = PACK_DEFINITIONS[event.product_id]; // { count, price_cents }
  await creditStampLot({
    userId: event.user_id,
    source: 'purchase',
    count: pack.count,
    priceCents: pack.price_cents,
    autumnCheckoutId: event.checkout_id,
  });
}
```

`creditStampLot` is the single chokepoint that inserts the lot, updates `users.stamps_balance`, and writes the corresponding `stamp_transactions` row, all in one DB transaction. All credit paths (purchase, signup grant, gift received) go through this function with different `source` values.

Existing Svix signature verification on the webhook is unchanged. The new handler is idempotent on `event.checkout_id` — replaying a webhook does not double-credit.

## UI

### Sender-facing surfaces

- **Balance indicator** in the app header: "5 stamps remaining" with an icon. Tap → opens stamps page.
- **Stamps page** (settings → stamps): current balance, "buy more" CTA, transaction history, refund button per refundable lot.
- **Buy modal**: triggered both from the stamps page and automatically when a send is attempted with a zero balance. Shows the three packs with the per-stamp price highlighted.
- **Send confirmation**: a subtle "1 stamp" indicator next to the send button — enough that the user knows it costs something, not so loud that it feels transactional.
- **Failed send notification**: clear message that the postcard didn't go through and the stamp has been refunded.

### Recipient-facing surfaces

Recipients see no stamp-related UI. From their perspective, receiving is free and always was.

## Migration and rollout

1. **Schema migration** in a maintenance window or via a forward-compatible migration (add columns/tables, no destructive changes).
2. **Backfill grants** for all existing users: every existing account gets a one-time grant of 10 stamps (more generous than new-user grants, as a thank-you for early adoption). This is logged as `source='grant'` with a distinct `reason='migration_grant'` in `stamp_transactions` for accounting clarity.
3. **Soft launch**: ship behind a feature flag, enable for a small percentage of users, watch for issues with the atomic debit logic under real load.
4. **Public launch**: announce on Bluesky (naturally), update marketing site, enable for all users.
5. **Watch for 30 days**: monitor send rates, conversion from free-tier to first purchase, refund rate, failed-send-refund rate, support volume. Adjust pack pricing or sizes if the data warrants.

## Open questions

- **Volume of free grants for new users.** 5 is the proposed number; this should be revisited after launch based on conversion data. If most users exhaust grants quickly and don't convert, we may be charging too much per stamp. If most users never run out, we may be granting too generously.
- **Refund window.** Should there be a time limit on refunds (e.g., no refunds on packs older than 12 months)? Not in v1, but worth tracking as a potential issue.
- **Dispute handling.** Stripe chargebacks cost $15 each. If chargeback rate becomes meaningful, we may need to add friction to the purchase flow (e.g., require a verified email).
- **VAT/sales tax.** Not handled in v1. Stripe Tax via Autumn may be needed if international sales become material.
- **Pricing in non-USD markets.** Out of scope for v1 but worth thinking about — a $5 starter pack reads very differently in different countries.

## Appendix: example user journeys

### Journey 1: new user, eventually paying

1. Alice signs up. Receives 5 grant stamps. `stamps_balance = 5`.
2. Alice sends 3 postcards over a week. Grant lot debited 3×. `stamps_balance = 2`.
3. Alice tries to send a 4th, 5th, 6th. Grant lot exhausted on the 5th. On the 6th send, buy modal appears.
4. Alice buys the Bundle (25 stamps, $10). New `purchase` lot created with `price_paid_cents = 1000`. `stamps_balance = 25`.
5. Alice sends the 6th postcard. Purchase lot debited. `stamps_balance = 24`.
6. Six months later, Alice has 8 stamps left in the Bundle lot. She requests a refund. She receives 8 × $0.40 = $3.20 back. Lot zeroed out. `stamps_balance = 0`.

### Journey 2: failed send

1. Bob has `stamps_balance = 12`.
2. Bob sends a postcard to a typo'd email address. Send flow debits one stamp. `stamps_balance = 11`.
3. Resend returns a hard bounce 30 seconds later. Failed-send refund path runs.
4. `stamps_balance = 12`. Bob sees a notification: "Couldn't deliver to that address — your stamp has been refunded."

### Journey 3: gift

1. Carol buys the Starter pack ($5, 10 stamps) as a gift for Dan.
2. Dan doesn't have an account yet. A pending gift is created against `dan@example.com`.
3. Dan signs up. The pending gift is converted to a `gift_received` lot of 10 stamps. Dan also receives the standard 5-stamp signup grant. `stamps_balance = 15`.
4. Dan starts sending. The grant lot is consumed first (5 sends), then the gift lot (10 sends).
5. Carol cannot refund the gift once Dan has used any of it. If she requests a refund within 30 days and Dan hasn't used any, the unused portion is refunded to Carol at her original $0.50/stamp price.
