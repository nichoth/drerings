# PRD: Drerings Stamps Monetization

## Introduction

Drerings will monetize via prepaid "stamps" — a one-time-purchase credit
system where one stamp is consumed per postcard sent to a recipient. Stamps
never expire, are refundable on a prorated basis, and can be gifted between
users (including to non-users via pending invitations). Failed sends do not
consume a stamp. Posts to Bluesky remain free and unmetered.

This PRD covers the full v1 scope: data model, purchase flow, send-debit,
refunds, gifting (with pending invitations), signup grant, migration
backfill, and supporting UI. It launches directly to all users (no feature
flag). The companion design doc lives at `docs/monetization.md`.

## Goals

- Generate per-postcard revenue at an effective price of ~$0.33–$0.50 per
  stamp without paying Stripe fees on every send.
- Preserve product framing: paid behavior is the 1:1 postcard; Bluesky
  broadcast remains free.
- Zero friction at send time — no payment modal mid-flow except when the
  user has hit zero balance.
- Every new user gets 5 free stamps to experience the product before
  paying.
- Existing users get 10 free stamps on rollout as a thank-you.
- Refunds, gifting, and dispute resolution remain operationally simple and
  self-service where possible.

## User Stories

Stories are grouped in implementation phases. Each story is sized for one
focused session.

### Phase 1: Data Model & Core Services

#### US-001: Schema migration for stamp accounting
**Description:** As a developer, I need the database schema for tracking
stamp balances, lots, and transactions so that all subsequent stamp logic
has a foundation.

**Acceptance Criteria:**
- [ ] `users.stamps_balance INTEGER NOT NULL DEFAULT 0` column added
- [ ] `stamp_lots` table created per design doc schema (with CHECK
      constraints and `idx_lots_consumption` partial index)
- [ ] `stamp_transactions` table created with `idx_stamp_tx_user_created`
      index
- [ ] Migration runs forward-compatibly (additive only, no destructive
      changes)
- [ ] Migration is reversible (down migration drops new tables/columns
      cleanly)
- [ ] Typecheck and lint pass

#### US-002: `creditStampLot` service function
**Description:** As a developer, I need a single chokepoint function that
inserts a stamp lot, updates the user's balance cache, and writes a
transaction row — all in one DB transaction — so that every credit path
(purchase, grant, gift) stays consistent.

**Acceptance Criteria:**
- [ ] Function signature accepts `{ userId, source, count, priceCents?,
      autumnCheckoutId?, giftedByUserId? }`
- [ ] Inserts `stamp_lots` row with `original_count = remaining_count =
      count`
- [ ] Atomically updates `users.stamps_balance += count`
- [ ] Inserts `stamp_transactions` row with `delta = +count`, correct
      `reason`, `balance_after`
- [ ] All three writes happen in one BEGIN/COMMIT
- [ ] Unit tests cover purchase, grant, and gift_received paths
- [ ] Typecheck and lint pass

#### US-003: `debitStamp` service function (atomic FIFO)
**Description:** As a developer, I need an atomic debit function that
selects the correct lot per FIFO-with-grants-first rules and prevents
negative balances under concurrent sends, so that the send flow can rely
on a single primitive.

**Acceptance Criteria:**
- [ ] Uses `FOR UPDATE SKIP LOCKED` SELECT per design doc query
- [ ] Order: non-purchase lots first, then purchased lots by
      `created_at ASC`
- [ ] Decrements `stamp_lots.remaining_count` by 1
- [ ] Decrements `users.stamps_balance` by 1 with guard
      `WHERE stamps_balance > 0`
- [ ] Inserts `stamp_transactions` row with `delta = -1`, `lot_id`,
      `reason = 'send'`, `balance_after`
- [ ] Returns the affected `lot_id` (needed for failed-send refund)
- [ ] Throws `InsufficientStampsError` when no lot available
- [ ] Concurrency test: two simultaneous debits on balance of 1 → one
      success, one error, no negative balance
- [ ] Typecheck and lint pass

#### US-004: `refundFailedSend` service function
**Description:** As a developer, I need a function that re-credits a
specific lot when a send fails, so the failed-send refund path can be
called from the send flow's error handler.

**Acceptance Criteria:**
- [ ] Accepts `{ userId, lotId }`
- [ ] Increments `stamp_lots.remaining_count` by 1 on the specific lot
- [ ] Increments `users.stamps_balance` by 1
- [ ] Inserts `stamp_transactions` row with `delta = +1`,
      `reason = 'failed_send_refund'`, `lot_id`, `balance_after`
- [ ] All writes in one transaction
- [ ] Unit tests pass
- [ ] Typecheck and lint pass

### Phase 2: Autumn Integration & Purchase Flow

#### US-005: Configure three stamp pack products in Autumn
**Description:** As a product owner, I need the three pack tiers
configured in Autumn so users can purchase them via Stripe checkout.

**Acceptance Criteria:**
- [ ] Product `stamps_starter` created in Autumn: 10 stamps, $5.00
- [ ] Product `stamps_bundle` created in Autumn: 25 stamps, $10.00
- [ ] Product `stamps_big_bundle` created in Autumn: 60 stamps, $20.00
- [ ] Product metadata records stamp count and per-stamp price
- [ ] `PACK_DEFINITIONS` constant in code matches Autumn config
- [ ] Test checkout works end-to-end in staging

#### US-006: Autumn webhook handler for stamp purchases
**Description:** As a developer, I need the existing Autumn webhook
handler at `/api/billing/webhook` to branch on stamp pack product IDs and
credit the user's account.

**Acceptance Criteria:**
- [ ] Handler detects `event.type === 'checkout.completed'` with
      `product_id` starting `stamps_`
- [ ] Looks up pack definition by `product_id`
- [ ] Calls `creditStampLot` with `source: 'purchase'`,
      `autumnCheckoutId: event.checkout_id`, correct count and price
- [ ] Idempotent on `event.checkout_id` — replay does not double-credit
      (check for existing `stamp_transactions` row with matching
      `reference_id`)
- [ ] Existing Svix signature verification still applies
- [ ] Integration test simulates a webhook event and verifies the lot is
      created
- [ ] Typecheck and lint pass

#### US-007: Buy-pack modal UI
**Description:** As a user, I want to see the three pack options with
clear pricing so I can choose what to buy.

**Acceptance Criteria:**
- [ ] Modal shows three packs (Starter / Bundle / Big bundle) side by
      side
- [ ] Each pack displays: stamp count, total price, per-stamp price
- [ ] "Buy" button per pack initiates Autumn checkout for that product
- [ ] Bundle is visually highlighted as the recommended option
- [ ] Closes cleanly without state leaks
- [ ] Typecheck and lint pass
- [ ] Verify in browser using dev-browser skill

#### US-008: Auto-open buy modal on zero-balance send attempt
**Description:** As a user, when I try to send a postcard with zero
stamps, I want to be prompted to buy more without losing my draft.

**Acceptance Criteria:**
- [ ] Send action checks balance before attempting debit
- [ ] If `stamps_balance === 0`, buy modal opens
- [ ] Postcard draft (canvas state, recipient) is preserved while modal
      is open
- [ ] After successful purchase (webhook credits balance), user can
      retry the send
- [ ] Typecheck and lint pass
- [ ] Verify in browser using dev-browser skill

### Phase 3: Signup Grant & Migration Backfill

#### US-009: Grant 5 free stamps on new account signup
**Description:** As a new user, I want 5 free stamps so I can try
sending postcards before deciding to pay.

**Acceptance Criteria:**
- [ ] Signup flow calls `creditStampLot` with `source: 'grant'`,
      `count: 5`, `priceCents: null`
- [ ] `stamp_transactions.reason = 'grant'`
- [ ] New user's `stamps_balance` is 5 immediately after account
      creation
- [ ] Integration test: create account → balance is 5
- [ ] Typecheck and lint pass

#### US-010: Backfill grant of 10 stamps for existing users
**Description:** As an existing user, I want to receive 10 free stamps
on rollout as a thank-you for early adoption.

**Acceptance Criteria:**
- [ ] One-time backfill script grants 10 stamps to every existing user
- [ ] Each grant uses `creditStampLot` with `source: 'grant'`
- [ ] `stamp_transactions.reason = 'migration_grant'` (distinct from
      regular signup grant for accounting clarity)
- [ ] Script is idempotent — running it twice does not double-credit
      (check for existing `migration_grant` transaction per user)
- [ ] Script logs total users processed and total stamps granted
- [ ] Dry-run mode available
- [ ] Typecheck and lint pass

### Phase 4: Send Flow Integration

#### US-011: Integrate debit into postcard send flow
**Description:** As a user, when I send a postcard, one stamp is
debited before the postcard is dispatched so revenue is tracked
correctly.

**Acceptance Criteria:**
- [ ] Send endpoint calls `debitStamp` before any delivery work
- [ ] If `InsufficientStampsError` is thrown, send fails with a clear
      error before any delivery is attempted
- [ ] `lot_id` from debit is held in scope for the duration of the
      delivery attempt
- [ ] `stamp_transactions.reference_id` is set to the `postcard_id`
- [ ] Integration test: send postcard → balance decremented by 1, lot
      decremented, transaction row exists
- [ ] Typecheck and lint pass

#### US-012: Failed-send refund path
**Description:** As a user, if a postcard fails to deliver, I want my
stamp returned automatically and a clear notification.

**Acceptance Criteria:**
- [ ] Send flow's error handler calls `refundFailedSend` for:
      Resend hard bounce, blob write failure (after retries),
      malformed recipient address
- [ ] Recipient never opening, marking as spam, or sender regret do
      NOT trigger refund
- [ ] User-facing notification: "Couldn't deliver to that address —
      your stamp has been refunded."
- [ ] Integration test: trigger hard bounce → balance restored,
      `failed_send_refund` transaction exists
- [ ] Typecheck and lint pass
- [ ] Verify in browser using dev-browser skill

#### US-013: Send confirmation UI with "1 stamp" indicator
**Description:** As a user, I want to see that sending costs one stamp
without it feeling transactional, so I understand the cost without
feeling nickel-and-dimed.

**Acceptance Criteria:**
- [ ] Subtle "1 stamp" indicator next to the send button on the
      postcard composer
- [ ] Indicator uses the stamp icon used elsewhere
- [ ] Not a modal, not a confirmation step — just a visible label
- [ ] Typecheck and lint pass
- [ ] Verify in browser using dev-browser skill

### Phase 5: Refund Flow

#### US-014: Refund calculation service
**Description:** As a developer, I need a function that calculates the
prorated refund amount for a given lot so refund logic is consistent.

**Acceptance Criteria:**
- [ ] Accepts a `stamp_lots` row
- [ ] Returns `refund_cents = remaining_count *
      (price_paid_cents / original_count)` using integer math
- [ ] Returns 0 (and rejects) for non-purchase lots
- [ ] Returns 0 for lots with `remaining_count = 0`
- [ ] Unit tests cover: full refund, partial refund, fully-used lot,
      grant lot, gift lot
- [ ] Typecheck and lint pass

#### US-015: Refund API endpoint
**Description:** As a user, I want to request a refund of unused stamps
from a specific lot so I can recover money for stamps I won't use.

**Acceptance Criteria:**
- [ ] `POST /api/stamps/refund/:lotId` endpoint
- [ ] Validates: caller owns the lot, `source = 'purchase'`,
      `remaining_count > 0`
- [ ] Calls refund calculation, then in one DB transaction:
      zero out `remaining_count`, decrement `stamps_balance`, insert
      `refund` transaction row with `delta = -remaining_count`
- [ ] Calls Autumn to issue refund against `autumn_checkout_id`
- [ ] On Autumn failure: reverses local state changes and surfaces
      error; logs for manual reconciliation
- [ ] Returns refund amount in cents and updated balance
- [ ] Integration test: refund 15 of 25 stamps in $10 pack → $6.00
      refund issued
- [ ] Typecheck and lint pass

#### US-016: Refund UI on stamps page
**Description:** As a user, I want to see my refundable lots and
trigger a refund with one click.

**Acceptance Criteria:**
- [ ] Each refundable lot displayed with: purchase date, original
      count, remaining count, refund amount preview
- [ ] "Refund unused stamps" button per refundable lot
- [ ] Confirmation step before submission ("Refund $X.XX to your card?")
- [ ] Success message shows refund amount and new balance
- [ ] Granted and gifted lots displayed but without refund button, with
      explanation tooltip
- [ ] Typecheck and lint pass
- [ ] Verify in browser using dev-browser skill

### Phase 6: Gifting

#### US-017: Gift pack purchase flow (existing recipient)
**Description:** As a user, I want to buy a pack for another Drerings
user so I can share stamps with friends.

**Acceptance Criteria:**
- [ ] Gift purchase UI: select pack, enter recipient email or username,
      confirm
- [ ] Existing user lookup by email/username
- [ ] On successful checkout (Autumn webhook), `creditStampLot` is
      called for the recipient with `source: 'gift_received'`,
      `giftedByUserId: senderId`, `priceCents` from pack
- [ ] Sender's balance is unaffected
- [ ] Recipient sees the gift in their transaction history
- [ ] Sender sees the gift in their transaction history (as outgoing
      gift)
- [ ] Notification email to recipient: "Alice sent you 25 stamps."
- [ ] Typecheck and lint pass
- [ ] Verify in browser using dev-browser skill

#### US-018: Pending gift for non-user recipient
**Description:** As a user, I want to gift a pack to someone who
doesn't have a Drerings account yet, so I can recruit them.

**Acceptance Criteria:**
- [ ] If recipient email has no account, a `pending_gifts` record is
      created (new table) on successful checkout
- [ ] Fields: `id`, `sender_user_id`, `recipient_email`, `pack_id`,
      `count`, `price_cents`, `autumn_checkout_id`, `created_at`,
      `status` ('pending' | 'claimed' | 'refunded')
- [ ] Invitation email sent to recipient with signup link
- [ ] Sender sees pending gift in their stamps page
- [ ] Typecheck and lint pass
- [ ] Verify in browser using dev-browser skill

#### US-019: Pending gift conversion on recipient signup
**Description:** As a recipient of a pending gift, when I sign up, the
gifted stamps are credited to my new account.

**Acceptance Criteria:**
- [ ] Signup flow checks `pending_gifts` for recipient email
- [ ] For each pending gift, `creditStampLot` is called with
      `source: 'gift_received'`, correct count, price, gifter id, and
      original `autumn_checkout_id`
- [ ] `pending_gifts.status` updated to `'claimed'`
- [ ] New user still receives the standard 5-stamp signup grant in
      addition
- [ ] Integration test: sender gifts → recipient signs up → recipient
      has gift + signup grant
- [ ] Typecheck and lint pass

#### US-020: Auto-refund pending gifts older than 90 days
**Description:** As a sender, if my gift recipient never signs up
within 90 days, I want the gift automatically refunded.

**Acceptance Criteria:**
- [ ] Background job runs daily
- [ ] Finds `pending_gifts` with `status = 'pending'` and
      `created_at < now() - 90 days`
- [ ] Calls Autumn refund against `autumn_checkout_id`
- [ ] Updates `status = 'refunded'`
- [ ] Sends email to sender: "Your gift to X was refunded —
      they didn't claim it."
- [ ] Idempotent — job can run twice without double-refunding
- [ ] Typecheck and lint pass

#### US-021: Sender's 30-day refund window on unused gifts
**Description:** As a gift sender, I want to refund a gift if the
recipient hasn't used any of the stamps within 30 days.

**Acceptance Criteria:**
- [ ] Sender's stamps page shows gifts they've sent with status:
      "unused (refundable until DATE)" or "in use (final)"
- [ ] Refund button shown only when:
      gift was created < 30 days ago AND
      recipient's gift lot `remaining_count == original_count`
- [ ] Refund flow zeroes the recipient's lot, decrements their
      balance, issues Autumn refund to sender's payment method
- [ ] Recipient sees `stamp_transactions` row noting the gift was
      reclaimed
- [ ] Typecheck and lint pass
- [ ] Verify in browser using dev-browser skill

### Phase 7: Stamps Page & Balance Indicator

#### US-022: Balance indicator in app header
**Description:** As a user, I want to see my stamp count at all times
so I know when I need to buy more.

**Acceptance Criteria:**
- [ ] Header shows current balance with stamp icon: e.g. "5 stamps"
- [ ] Tappable — opens stamps page
- [ ] Reactive — updates when balance changes (signal-based)
- [ ] Visible on all authenticated routes
- [ ] Typecheck and lint pass
- [ ] Verify in browser using dev-browser skill

#### US-023: Stamps page (settings → stamps)
**Description:** As a user, I want a dedicated page to see my balance,
buy more stamps, view transaction history, and manage refunds/gifts.

**Acceptance Criteria:**
- [ ] Route at `/settings/stamps`
- [ ] Shows: current balance, "buy more" CTA, transaction history list,
      lots with refund actions (US-016), sent gifts (US-021)
- [ ] Transaction history shows: date, reason, delta, balance after
- [ ] Pagination or virtualization for long histories (>50 entries)
- [ ] Linked from settings navigation
- [ ] Typecheck and lint pass
- [ ] Verify in browser using dev-browser skill

### Phase 8: Bluesky & Monitoring

#### US-024: Verify Bluesky posting does not consume stamps
**Description:** As a product owner, I need explicit verification that
posting to Bluesky does not consume stamps, so the free-broadcast
positioning holds.

**Acceptance Criteria:**
- [ ] Bluesky post code path has no calls to `debitStamp`
- [ ] Integration test: post to Bluesky → balance unchanged
- [ ] Bluesky post button is enabled even when `stamps_balance = 0`
- [ ] Typecheck and lint pass

#### US-025: Invariant verification background job
**Description:** As a developer, I need a periodic job that verifies
the data invariants hold, so we catch any drift before it compounds.

**Acceptance Criteria:**
- [ ] Job verifies for every user:
      `users.stamps_balance ==
       SUM(stamp_lots.remaining_count WHERE user_id = ...)`
- [ ] Job verifies for every user:
      `SUM(stamp_transactions.delta WHERE user_id = ...) ==
       users.stamps_balance`
- [ ] Drift is logged with user_id, expected, actual
- [ ] Alerts (email or log-based notification) on any drift
- [ ] No automatic reconciliation in v1 — human investigates first
- [ ] Runs daily via scheduled function
- [ ] Typecheck and lint pass

## Functional Requirements

### Data model

- FR-1: `users.stamps_balance INTEGER NOT NULL DEFAULT 0` is the
  authoritative fast-read balance.
- FR-2: `stamp_lots` is the per-unit source of truth, recording every
  credit (purchase, grant, gift_received) with `source`,
  `original_count`, `remaining_count`, `price_paid_cents`,
  `autumn_checkout_id`, `gifted_by_user_id`.
- FR-3: `stamp_transactions` is an append-only event log; no updates or
  deletes ever.
- FR-4: A new `pending_gifts` table tracks gifts to non-users with
  status: `pending` | `claimed` | `refunded`.

### Credit paths

- FR-5: All credits go through `creditStampLot`, which inserts a lot,
  updates `stamps_balance`, and writes a transaction row in one DB
  transaction.
- FR-6: New users receive a 5-stamp grant on signup
  (`reason='grant'`).
- FR-7: Existing users receive a one-time 10-stamp migration backfill
  (`reason='migration_grant'`).
- FR-8: Purchases credit on Autumn `checkout.completed` webhook,
  idempotent on `checkout_id`.

### Debit / send flow

- FR-9: Sending a postcard atomically debits exactly one stamp via
  `debitStamp` BEFORE the delivery attempt.
- FR-10: Consumption order: non-purchase lots first (grants, gifts),
  then purchased lots FIFO by `created_at`.
- FR-11: Concurrent send attempts at balance 1 must result in exactly
  one success; the other gets `InsufficientStampsError`. Use
  `FOR UPDATE SKIP LOCKED`.
- FR-12: Failed delivery (Resend hard bounce, blob write failure after
  retries, malformed address) triggers `refundFailedSend` on the same
  lot.
- FR-13: User regret, recipient never opening, and spam markings do NOT
  trigger refunds.

### Refunds

- FR-14: Refunds are self-service per refundable lot from the stamps
  page.
- FR-15: Refund amount =
  `remaining_count * (price_paid_cents / original_count)`.
- FR-16: Only purchased lots are refundable. Grants and gifts received
  are never refundable for cash by the holder.
- FR-17: Refund flow updates local state first, then calls Autumn; on
  Autumn failure, local state is reversed and the error is surfaced.
- FR-18: Stripe processing fees on the original charge are NOT returned
  on refund (per Stripe policy).

### Gifting

- FR-19: Users can buy a pack as a gift, specifying recipient by email
  or username.
- FR-20: If the recipient has an account, the pack is credited as a
  `gift_received` lot. Sender's balance is unaffected.
- FR-21: If the recipient has no account, a `pending_gifts` record is
  created and an invitation email is sent.
- FR-22: On signup with a pending-gifted email, the gift is converted
  to a `gift_received` lot AND the signup grant is also issued.
- FR-23: Pending gifts older than 90 days are auto-refunded to the
  sender daily.
- FR-24: Senders can refund a gift if it was created less than 30 days
  ago AND the recipient hasn't used any of the gifted stamps.

### Bluesky

- FR-25: Posting to Bluesky does NOT consume a stamp.
- FR-26: The Bluesky post action is always enabled, including when
  `stamps_balance = 0`.

### Pricing

- FR-27: Three packs at launch:
  - Starter: 10 stamps for $5.00 ($0.50/stamp)
  - Bundle: 25 stamps for $10.00 ($0.40/stamp)
  - Big bundle: 60 stamps for $20.00 ($0.33/stamp)
- FR-28: USD only.

### Monitoring

- FR-29: A daily background job verifies the data invariants
  (balance == sum of lots == sum of transactions) and alerts on
  drift. No automatic reconciliation in v1.

## Non-Goals

- Subscription pricing. Prepaid credits only at launch.
- Cross-currency pricing. USD only.
- Stamp expiry. Stamps are perpetual.
- Charging recipients. Receiving is always free.
- Gifting individual stamps from existing balance (only pack-gifting
  in v1).
- VAT / sales tax handling.
- Refund of "I changed my mind" sends (only delivery failures).
- Refunds for stamps marked as spam or unopened by recipient.
- Pricing tiers outside USD.
- Refund window limits on purchased lots (no v1 expiry on refund
  rights).
- Feature flag / soft launch / percentage rollout — direct launch to
  all users.

## Design Considerations

- Reuse existing badge/button components from the design system.
- Stamps page lives under existing settings navigation
  (`/settings/stamps`).
- Use existing stamp icon (or create one if none exists) consistently
  across header indicator, send button, buy modal, and stamps page.
- Balance indicator must be reactive — uses `@preact/signals` to
  update across the app when balance changes.
- Buy modal styling should make Bundle (25 stamps) the visually
  highlighted recommended option.
- The "1 stamp" indicator on the send button should be subtle — not
  a confirmation step, not a modal.
- Failed-send notification uses the existing toast/notification
  pattern.

## Technical Considerations

### Stack alignment

- Netlify Functions for API endpoints
- Netlify Database (Postgres) for schema
- Netlify Blobs for postcard PNG storage (unchanged)
- Resend for transactional email (unchanged; reused for gift
  invitations and failed-send notifications)
- Autumn / Stripe for one-time pack purchases (extends existing
  subscription wiring)
- `@preact/signals` for frontend reactive state (balance indicator)

### Critical correctness requirements

- All credit and debit paths must use DB transactions.
- `debitStamp` MUST use `FOR UPDATE SKIP LOCKED` to handle
  concurrent sends.
- The Autumn webhook handler MUST be idempotent on `checkout_id`.
- The migration backfill script MUST be idempotent.
- The 90-day pending-gift auto-refund job MUST be idempotent.

### Code conventions (per CLAUDE.md)

- TypeScript with no space between colon and type annotation
- Lines under 80 columns
- Use `batch` from `@preact/signals` when setting multiple signals
- Prefer nested CSS selectors over class proliferation
- Use existing CSS variables from `_variables.css` / `_vars.css`

### Order of operations for send (critical)

1. Debit (atomic) → 2. Commit → 3. Attempt delivery → 4. If
   delivery fails, refund.

NEVER reverse this order. A crash between "send" and "debit" creates
a revenue leak and no audit trail; a crash between "debit" and "send"
leaves a missing stamp recoverable via the refund path.

## Success Metrics

- **Conversion**: percentage of users who buy at least one pack
  within 30 days of exhausting the signup grant.
- **Pack mix**: distribution of Starter / Bundle / Big bundle
  purchases. Target: Bundle is the modal choice past first purchase.
- **Refund rate**: percentage of purchased stamps refunded.
  Acceptable: < 5% in steady state.
- **Failed-send refund rate**: percentage of sends that trigger
  failed-send refunds. Acceptable: < 2%. Higher signals delivery
  problems.
- **Chargeback rate**: percentage of purchases resulting in Stripe
  chargebacks. Acceptable: < 0.5%.
- **Invariant drift events**: target zero. Any non-zero count
  triggers investigation.
- **Bluesky post volume**: should NOT decline post-launch — free
  broadcast must remain frictionless.

## Open Questions

- Volume of signup grant (5 stamps) — revisit after 60–90 days of
  data. Increase if free-to-paid conversion is too low; decrease if
  users never run out.
- Refund window on purchased packs older than 12 months — not
  enforced in v1; revisit if it becomes a support burden.
- Chargeback friction — if chargeback rate is high, consider
  requiring verified email before purchase.
- VAT/sales tax via Stripe Tax — defer until international sales
  become material.
- Non-USD pricing — out of scope for v1.
- Notification UX for gift recipients (already-users) — should the
  recipient see an in-app notification in addition to the email?
- Should the buy modal default-select the Bundle, or just visually
  highlight it without pre-selection?
