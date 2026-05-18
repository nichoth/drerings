# Share Quota Design

## Summary

This change collapses the drerings pricing model from a
subscription-plus-stamps dual tier into a single free tier with
optional stamp packs, then introduces share quota enforcement as
the first feature that actually consumes stamps outside of
postcards.

On the infrastructure side, the work starts with three database
migrations: a pre-release destructive reset that replaces
email/passkey identity with Bluesky DID-keyed users, a new
append-only `share_events` table, and an extension to the
`stamp_transactions.reason` enum. Authentication is replaced
wholesale: the existing email/passkey/magic-link stack is removed
and the previously-shelved Bluesky OAuth implementation (DPoP
keypair, PAR, PKCE, cookie-stateless session) is revived. On the
billing side, the subscription tier and its Autumn checkout path
are deleted; the stamp pack catalog collapses from three entries
to two with new product IDs.

The share quota is enforced server-side via a two-step
precheck/confirm pattern that mirrors the existing postcard send
flow: precheck returns a discriminated union
(`free` | `paid` | `blocked` | `reused`), and confirm runs a
`SELECT ... FOR UPDATE` transaction that re-evaluates the decision
under lock to handle concurrent requests safely. The client drives
a simple UX state machine off the response types, using
`@preact/signals` and `batch` per house style.

## Definition of Done

### Auth & identity
- Bluesky OAuth login restored (reference: prior commits `34edfab` +
  `eab1f3c`, plus the official atproto OAuth docs). Email / passkey /
  magic-link auth is removed.
- Users are keyed 1:1 by Bluesky DID. All existing user records are
  wiped (this is pre-release; no migration code path).
- `SessionUser` drops `email` and `subscription_status`; gains `did`
  and `handle`.

### Pricing model collapse
- The monthly subscription tier is removed entirely. There is no
  longer a `$5/month` plan. `users.subscription_status` and
  `users.subscription_current_period_end` columns are dropped;
  `users.autumn_customer_id` stays (still used for stamp pack
  purchases).
- All previously paid-gated features (save drawings, reopen saved
  drawings, publish to stable public URLs, share) become available
  to any authed user.
- `State.StartCheckout`, the subscription email form on `/pricing`,
  the subscription tier card, the `isPaid` signal, and the
  subscription branches of `billing.ts` / billing webhook are
  removed.

### Stamp packs
- `PACK_DEFINITIONS` in `src/stamp-packs.ts` collapses from three
  entries to two, with product IDs that match the Autumn dashboard:
  - `10_stamps` — 10 stamps for $5
  - `25_stamps` — 25 stamps for $10
- `stamps_big_bundle` is removed. References in `BuyPackModal`,
  `billing.ts`, and tests are updated.

### Share quota
- Any authed user sees the Share button on their drawings.
  Anonymous viewers do not.
- The server enforces: **1 free share per calendar month per DID**,
  evaluated in the user's *current* browser timezone (sent per
  request). Subsequent shares cost **1 stamp**.
- Share flow is two-step:
  1. Client click → server pre-check returns `free`, `paid`, or
     `blocked`.
  2. If `paid`, show a "use 1 stamp?" confirm dialog.
  3. Confirm endpoint records the share (and debits a stamp for the
     paid path) with an idempotency key. Cancel = no consumption.
- Zero stamps **and** no free share remaining: block with a message
  and a link to the pricing / buy-stamps page (no auto-open of the
  Buy Stamps modal).
- Share button label is always "Share"; cost is surfaced in the
  confirm dialog only. Pre-check runs on click, not on page load.
- All share-sheet destinations are counted uniformly. No
  per-destination logic (Bluesky vs SMS vs anything else are
  indistinguishable to us anyway).
- Postcards are unchanged — still always 1 stamp, separate from the
  share quota.

### Pricing page
- Pricing page copy is rewritten as a single tier ("Sign in (free)")
  plus the two stamp packs. The subscription form and tier card are
  removed.

## Acceptance Criteria

### share-quota.AC1: Bluesky OAuth login works
- **share-quota.AC1.1 Success:** User submits a valid Bluesky
  handle on `/login`; after redirect they return authed with a
  `users` row keyed by their DID.
- **share-quota.AC1.2 Success:** Returning user with an existing
  `users.did` row logs in again; their `handle` and
  `handle_updated_at` columns are refreshed (no duplicate row).
- **share-quota.AC1.3 Success:** Logout clears the
  `drerings_auth` cookie and `whoami` returns 401.
- **share-quota.AC1.4 Failure:** Callback called with a missing or
  mismatched `state` parameter returns 400 and writes no `users`
  row.

### share-quota.AC2: Subscription model is fully removed
- **share-quota.AC2.1 Success:** Any authed user can save a
  drawing, reopen it, and publish it to a public URL — the
  subscription gate is gone.
- **share-quota.AC2.2 Success:** `users` rows have no
  `subscription_status` or `subscription_current_period_end`
  columns; `SessionUser` and `AccountDetails` do not expose them.
- **share-quota.AC2.3 Success:** Stamp packs in
  `src/stamp-packs.ts` reduce to exactly two entries with IDs
  `10_stamps` (10 stamps / $5) and `25_stamps` (25 stamps / $10).
- **share-quota.AC2.4 Failure:** `State.StartCheckout`,
  `isPaid`, and the subscription email form on `/pricing` no
  longer exist; references to them anywhere in the codebase fail
  a search.

### share-quota.AC3: Authed-only sharing, with the free button
visible to all authed users
- **share-quota.AC3.1 Success:** An authed user viewing a post
  they own sees a Share button.
- **share-quota.AC3.2 Success:** An anonymous viewer of the same
  public post URL does not see a Share button.
- **share-quota.AC3.3 Failure:** Calling
  `POST /api/shares/precheck` without a valid session returns 401.
- **share-quota.AC3.4 Failure:** Calling
  `POST /api/shares/confirm` without a valid session returns 401.
- **share-quota.AC3.5 Success:** First share of the month: server
  pre-check returns `{type:'free'}`; client opens the share sheet
  immediately; no confirm dialog appears.
- **share-quota.AC3.6 Success:** Second share of the same month
  with stamps_balance > 0: pre-check returns `{type:'paid'}`;
  client shows the confirm dialog with a Cancel and a Confirm
  button.
- **share-quota.AC3.7 Success:** Pre-check + confirm with the
  same `idempotency_key` for the same `drawing_id` is treated as
  one share (no duplicate row, no double debit).

### share-quota.AC4: Quota accounting is correct
- **share-quota.AC4.1 Success:** First confirmed share of a
  user's calendar month (in their browser TZ) writes a
  `share_events` row with `was_free = true` and no
  `stamp_transactions` row.
- **share-quota.AC4.2 Success:** Subsequent confirmed share in
  the same month writes a `share_events` row with `was_free =
  false` AND a `stamp_transactions` row with `reason = 'share'`,
  `delta = -1`, and `reference_id = share_events.id`.
- **share-quota.AC4.3 Success:** A share in a new calendar month
  is free again, even if the previous month's free was already
  used.
- **share-quota.AC4.4 Success:** Month boundaries are computed in
  the IANA timezone the client supplies — same instant in
  different TZs can yield different `month_key` values.
- **share-quota.AC4.5 Failure:** Two concurrent confirms for the
  same user with no prior share that month: at most one is
  recorded as `was_free = true`; the other either records as paid
  (if stamps available) or returns `blocked`.
- **share-quota.AC4.6 Failure:** A `confirm` request with an
  `idempotency_key` that was already used for a different
  `drawing_id` returns 409.

### share-quota.AC5: Blocked path when out of free + stamps
- **share-quota.AC5.1 Success:** User has 0 stamps and has used
  their free share this month; pre-check returns `{type:'blocked',
  reason:'no_free_no_stamps'}`; confirm also returns `blocked`.
- **share-quota.AC5.2 Success:** Client renders a "You're out of
  stamps" message containing a link to `/pricing`; the Buy Stamps
  modal is NOT auto-opened.

### share-quota.AC6: Confirm-dialog interactions
- **share-quota.AC6.1 Success:** User clicks Cancel on the
  confirm dialog; no `confirm` request is sent; no `share_events`
  row is written; stamps_balance is unchanged.
- **share-quota.AC6.2 Success:** User clicks Confirm; the
  `confirm` request is sent exactly once; on success the share
  sheet opens.
- **share-quota.AC6.3 Failure:** Network error on `confirm`
  results in a visible error state and no `share_events` row;
  retrying with the same `idempotency_key` is safe.

### share-quota.AC7: Pricing page reflects the new model
- **share-quota.AC7.1 Success:** `/pricing` shows one info card
  ("Sign in (free)") summarizing the included features and the
  1-free-share-per-month rule.
- **share-quota.AC7.2 Success:** `/pricing` shows two stamp pack
  rows (`10_stamps` / $5, `25_stamps` / $10), each with a Buy
  button that opens `BuyPackModal` for the matching pack.

### share-quota.AC8: Suite-level cleanup
- **share-quota.AC8.1 Success:** `npm test && npm run lint` is
  clean; no tests reference subscription gating,
  `subscription_status`, magic links, passkeys, or the removed
  stamp pack IDs.

## Glossary

- **DID (Decentralized Identifier)**: A globally unique, persistent
  identifier issued by the AT Protocol (Bluesky's underlying
  protocol) and used here as the primary key for user records in
  place of email.
- **DPoP (Demonstrating Proof of Possession)**: An OAuth extension
  that binds access tokens to a client-held keypair, preventing
  token theft. Required by the atproto OAuth profile.
- **PAR (Pushed Authorization Request)**: An OAuth 2.0 extension
  where the client sends authorization parameters directly to the
  auth server before redirecting the user, rather than embedding
  them in the redirect URL. Required by atproto.
- **PKCE (Proof Key for Code Exchange)**: An OAuth 2.0 extension
  that prevents authorization code interception by binding the
  code to a verifier that only the originating client knows.
- **PDS (Personal Data Server)**: The atproto server that hosts a
  user's data. Each Bluesky user's handle resolves to a specific
  PDS, which in turn points to its authorization server.
- **atproto**: The AT Protocol — the open federated protocol
  underlying Bluesky. Its OAuth profile is distinct from standard
  OAuth 2.0 and requires DPoP, PAR, and a published client
  metadata document.
- **Autumn**: The third-party billing provider used for stamp pack
  purchases. Stamp packs are created in the Autumn dashboard;
  product IDs in `PACK_DEFINITIONS` must match the IDs configured
  there.
- **stamp**: A prepaid unit of currency in drerings, consumed when
  sending a postcard or (new) making a paid share. Stamps are
  bought in packs via Autumn.
- **stamp_transactions**: The append-only financial ledger table
  in Postgres that records every stamp debit and credit, keyed by
  `user_id` with a `reason` column (`'send'`, `'share'`, etc.) and
  a `reference_id` pointing to the originating domain table.
- **share_events**: New append-only table recording each share
  action, with a `month_key` (IANA-timezone-local `YYYY-MM`
  string) and a `was_free` flag. The paid-share linkage is
  recorded on `stamp_transactions.reference_id`, not here.
- **month_key**: A `YYYY-MM` string derived in the user's IANA
  timezone, used as the boundary for the one-free-share-per-month
  rule.
- **idempotency_key**: A UUID v4 generated client-side before the
  precheck call, passed through confirm, and enforced via a
  `UNIQUE (user_id, idempotency_key)` constraint to prevent
  double-writes on retries.
- **discriminated union**: A TypeScript pattern where a tagged
  `type` field narrows the full shape of a response object. Used
  here for `PrecheckResponse` and `ConfirmResponse` so the client
  can exhaustively switch on outcomes.
- **SELECT ... FOR UPDATE**: A Postgres row-level advisory lock
  acquired at the start of `recordShare`'s transaction, ensuring
  that two concurrent confirm requests for the same user
  serialize rather than both seeing "no free share used yet."
- **cookie-stateless session**: The auth session is stored
  entirely inside a signed HttpOnly cookie rather than in a
  database table, eliminating the need for a server-side session
  store. Two cookies are used: `drerings_oauth_init` (15-minute
  OAuth flow state) and `drerings_auth` (14-day post-login
  session).
- **canShare**: The existing client-side computed signal that
  previously gated sharing behind subscription status. After this
  change it collapses to `isAuthed` (any logged-in user may
  attempt a share).
- **append-only trigger**: A Postgres `BEFORE UPDATE` /
  `BEFORE DELETE` trigger that raises an exception, making the
  table immutable after insert. Already in place on
  `stamp_transactions` (migration 0007); replicated on
  `share_events` (migration 0011).

## Architecture

### Layers (top to bottom)

**Client (`src/routes/post.ts` + `src/state.ts`)**
The Share button is shown when the viewer is authed (`canShare`
becomes `isAuthed`; the previous subscription gate is removed). On
click, the client calls `POST /api/shares/precheck` with
`{drawing_id, timezone, idempotency_key}`. The response is a
discriminated union (`free` | `paid` | `blocked` | `reused`). The
client then either opens the share sheet immediately (`free`),
shows a "use 1 stamp?" confirm dialog (`paid`), shows a "You're out
of stamps" message linking to `/pricing` (`blocked`), or
short-circuits (`reused`). A new helper, `State.ShareDrawing`, owns
the flow and mirrors the existing `State.SendPostcard` shape.

**Endpoints (Netlify Functions)**
- `POST /api/shares/precheck` — read-only; returns the decision.
- `POST /api/shares/confirm` — single writer; idempotent on
  `(user_id, idempotency_key)`.
- `GET /.well-known/oauth-client-metadata.json` — atproto OAuth
  client metadata document.
- `GET /api/auth/login` / `GET /api/auth/callback` /
  `POST /api/auth/logout` — OAuth start, return, end. Flow state
  lives in a signed HttpOnly cookie; the post-login session lives
  in a separate signed HttpOnly cookie.

**Domain libs**
- `netlify/lib/shares.ts` (new) — `recordShare(opts)` is the only
  writer of `share_events` and the only caller of `debitStamp` for
  reason `share`. Mirrors `netlify/lib/postcards.ts`.
- `netlify/lib/auth/atproto.ts` (revived from `34edfab`) — DPoP
  keypair generation, PAR, PKCE, token exchange, DID/handle
  resolution.
- `netlify/lib/stamps.ts` (existing) — `debitStamp` is extended to
  accept a `reason` param so the share path can pass `'share'`
  instead of the implicit `'send'`.

**Database**
Three new migrations: a destructive pre-release wipe + schema
reset for DID-keyed users, a new `share_events` table, and a
`stamp_transactions.reason` enum extension.

### HTTP contracts

```ts
// POST /api/shares/precheck
type PrecheckRequest = {
    drawing_id:string
    timezone:string         // IANA name from Intl.DateTimeFormat()
    idempotency_key:string  // uuid v4, client-generated
}

type PrecheckResponse =
    | { type:'free'; month_key:string }
    | { type:'paid'; stamps_balance:number; month_key:string }
    | { type:'blocked'
        reason:'no_free_no_stamps'
        stamps_balance:0
        month_key:string }
    | { type:'reused'; was_free:boolean }

// POST /api/shares/confirm
type ConfirmRequest = {
    drawing_id:string
    timezone:string
    idempotency_key:string
}

type ConfirmResponse =
    | { type:'recorded'; was_free:boolean; stamps_balance:number }
    | { type:'blocked'; reason:'no_free_no_stamps' }

// 401 not authed
// 400 invalid IANA timezone
// 404 drawing not owned by user
// 409 same idempotency_key, different drawing_id
```

### Database contracts

`share_events` (new, append-only):

```sql
CREATE TABLE share_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    drawing_id UUID NOT NULL REFERENCES drawings(id),
    month_key TEXT NOT NULL,       -- 'YYYY-MM' in user TZ
    timezone TEXT NOT NULL,        -- IANA name
    was_free BOOLEAN NOT NULL,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key)
);

CREATE INDEX share_events_user_free_month_idx
    ON share_events (user_id, month_key)
    WHERE was_free = true;

-- Append-only triggers identical in shape to stamp_transactions
-- triggers (migration 0007).
```

`stamp_transactions.reason` gains `'share'`. Paid-share linkage:
`stamp_transactions.reference_id = share_events.id` (same join
pattern that postcards uses).

`users` (revised by migration 0010):

```
id                  UUID PK
did                 TEXT UNIQUE NOT NULL
handle              TEXT NOT NULL
handle_updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
autumn_customer_id  TEXT NULL          -- kept for stamp purchases
created_at          TIMESTAMPTZ
-- email, subscription_status,
-- subscription_current_period_end DROPPED
```

### Share-confirm transaction

`recordShare` runs a single SQL transaction:

```
BEGIN;
SELECT … FROM users WHERE id = $userId FOR UPDATE;
-- re-check inside the lock, in case the precheck was stale
SELECT count(*) FROM share_events
    WHERE user_id = $userId
      AND month_key = $monthKey
      AND was_free = true;

IF count = 0:
    INSERT INTO share_events (…, was_free = true) RETURNING id;
    COMMIT;  -- returns { type:'recorded', was_free:true }

ELSE IF users.stamps_balance > 0:
    INSERT INTO share_events (…, was_free = false) RETURNING id;
    debitStamp({ userId, referenceId: share_event.id,
                 reason: 'share' });
    COMMIT;  -- returns { type:'recorded', was_free:false }

ELSE:
    ROLLBACK;  -- returns { type:'blocked', reason:'no_free…' }
```

The `SELECT … FOR UPDATE` is the race-protection mechanism. A
second concurrent confirm sees the just-inserted free row and
degrades to the paid path (or to `blocked`).

## Existing Patterns

This design follows several patterns already in the codebase:

- **Domain table + stamp_transactions link.**
  `share_events` is to `stamp_transactions` what `postcards` is to
  `stamp_transactions`: a domain table for the business event, a
  ledger row for the financial debit (paid path only), and a join
  via `stamp_transactions.reference_id`. The shape and append-only
  triggers mirror migration 0007 (`stamp_transactions`).

- **Two-step idempotent flow.** Precheck + confirm with a
  client-generated `idempotency_key` and a unique constraint on
  `(user_id, idempotency_key)` mirrors `postcards/send.ts` and
  `findOrCreateQueuedPostcard` (no reservation/release dance).

- **Discriminated-union responses on the wire.** Matches
  `PostcardSendResult` (`src/state.ts`). The client switches on
  `type` to drive the UX state machine.

- **Cookie-stateless OAuth.** The revived auth lib follows the
  prior commit `34edfab`: a signed `drerings_oauth_init` cookie
  carries flow state (PKCE verifier, DPoP JWK, state, PDS
  endpoints) for 15 minutes; a signed `drerings_auth` cookie
  carries the post-login session (DID, handle, atproto tokens, DPoP
  JWK) for 14 days. No DB-backed session table.

- **Signals + `batch` for multi-signal client state.** Per
  CLAUDE.md house style, `State.ShareDrawing` wraps every
  multi-signal update in `batch(...)`.

- **Inline `getSession(event)` auth check.** Endpoints return
  `json(401, { error: 'Please sign in.' })` on miss (same as
  `account.ts:17`, `postcards/send.ts:26`). No `requireAuthedUser`
  helper is introduced; the existing inline pattern is kept.

**Divergence noted:** The `test/us001-no-atproto.test.ts` test
currently asserts no `@atproto/*` imports exist. This design
inverts that assertion (atproto becomes a required dependency of
the auth lib).

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Database migrations
**Goal:** Reset schema for DID-keyed users; add `share_events`;
extend the stamp-transactions reason enum.

**Components:**
- `netlify/migrations/0010_pre_release_reset_for_atproto.sql` —
  destructive truncate of all user-scoped tables; drop
  `users.email`, `users.email_verified_at` (if present),
  `users.subscription_status`,
  `users.subscription_current_period_end`; add `users.did`
  (unique), `users.handle`, `users.handle_updated_at`; drop
  obsolete tables (`magic_link_tokens`, `passkeys`,
  `email_change_requests` if present); keep
  `users.autumn_customer_id`.
- `netlify/migrations/0011_share_events.sql` — new `share_events`
  table, partial index on `(user_id, month_key) WHERE
  was_free = true`, append-only `BEFORE UPDATE` / `BEFORE DELETE`
  triggers.
- `netlify/migrations/0012_stamp_tx_share_reason.sql` — extend the
  CHECK constraint on `stamp_transactions.reason` to include
  `'share'`.

**Dependencies:** None.

**Done when:** Migrations apply cleanly against a fresh test
database; `npm test` and `npm run lint` pass.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Remove subscription code paths
**Goal:** Rip out the obsolete subscription tier; collapse the
`isPaid` notion.

**Components:**
- `src/state.ts` — remove `isPaid` signal, `State.StartCheckout`,
  `checkoutLoading`, `checkoutError`, subscription fields on
  `SessionUser` and `CurrentUser`. Update any computed signals
  that previously read `subscription_status`.
- `src/routes/pricing.ts` — remove the subscription form, tier
  card, and `Subscribe - $5/month` button. (Pricing rewrite
  happens in Phase 7; this phase just removes the dead UI to keep
  the build green.)
- `netlify/lib/billing.ts` — remove subscription-related branches
  (checkout creation for subscription product, subscription
  webhook handling). Keep stamp pack flows.
- `netlify/functions/billing/**` — remove subscription webhook
  handlers if they exist as separate files.
- `netlify/lib/account.ts` — remove
  `subscription_current_period_end` from `AccountDetails`.
- Tests asserting on `subscription_status` — delete or rewrite.

**Acceptance Criteria:** `share-quota.AC2.1`, `share-quota.AC2.2`,
`share-quota.AC2.4`.

**Dependencies:** Phase 1.

**Done when:** Build is green; tests verifying that
`subscription_status` no longer drives feature gating pass; no
imports of removed symbols remain.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Stamp pack rename and reduction
**Goal:** Collapse three packs to two; align product IDs with
Autumn.

**Components:**
- `src/stamp-packs.ts` — `PACK_DEFINITIONS` becomes
  `{ '10_stamps': {…, count:10, priceCents:500},
     '25_stamps': {…, count:25, priceCents:1000} }`. Remove
  `stamps_big_bundle`. Rename `stamps_starter` → `10_stamps`,
  `stamps_bundle` → `25_stamps`.
- `src/components/buy-pack-modal.ts` — update any references to
  removed/renamed pack IDs.
- `netlify/lib/billing.ts` — update product ID mapping used when
  calling Autumn checkout.
- Tests in `test/us005-stamp-packs.test.ts`,
  `test/us007-buy-pack-modal.test.ts`, etc. — update fixtures and
  assertions to match the new IDs.

**Acceptance Criteria:** `share-quota.AC2.3`.

**Dependencies:** Phase 1.

**Done when:** Buying either pack via the dev Autumn sandbox
credits the correct number of stamps; tests pass; no references
to `stamps_starter`, `stamps_bundle`, or `stamps_big_bundle`
remain in code.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: atproto OAuth revival
**Goal:** Bluesky OAuth login + DID-keyed `users` upsert.

**Components:**
- `netlify/lib/auth/atproto.ts` — port the structure of the prior
  commit `34edfab`'s `netlify/functions/auth.ts`. Pure-functional
  helpers for DPoP keypair generation, PKCE challenge, PAR
  request, token exchange, DID/handle resolution.
- `netlify/functions/auth/login.ts` — `GET /api/auth/login?handle=…`.
  Resolves handle → DID, discovers PDS + auth server, PARs,
  writes signed `drerings_oauth_init` cookie, 302 to the
  authorize URL.
- `netlify/functions/auth/callback.ts` — `GET /api/auth/callback`.
  Verifies state, exchanges code for tokens, upserts `users` by
  DID, writes signed `drerings_auth` session cookie, clears
  `drerings_oauth_init`, 302 to `/`.
- `netlify/functions/auth/logout.ts` — clears `drerings_auth`.
- `netlify/functions/oauth-client-metadata.ts` — serves
  `/.well-known/oauth-client-metadata.json`. `client_id` equals
  the metadata document's own URL; localhost dev uses the
  embedded-client_id loophole on `127.0.0.1`.
- `netlify/lib/session.ts` — payload type updated to include
  `did`, `handle`, and the atproto session bundle (access JWT,
  refresh JWT, DPoP JWK, PDS origin). HMAC signing/verification
  unchanged in shape.
- `netlify/lib/auth-store.ts` — `SessionUser` interface updated
  per the contract in Architecture.
- `src/routes/login.ts` — replace email/passkey UI with a single
  "Sign in with Bluesky" handle-entry form.
- `package.json` — add `@atproto/api` and `@atproto/identity`.
- `test/us001-no-atproto.test.ts` — invert the assertion (atproto
  imports ARE expected).

**Acceptance Criteria:** `share-quota.AC1.1`, `share-quota.AC1.2`,
`share-quota.AC1.3`, `share-quota.AC1.4`.

**Dependencies:** Phase 1, Phase 2.

**Done when:** End-to-end login against the live Bluesky PDS
succeeds; a `users` row is upserted by DID; the session cookie
round-trips; `whoami` returns `{ id, did, handle, stamps_balance }`;
logout clears the cookie; tests pass.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Share endpoints and domain lib
**Goal:** Server enforcement of the monthly free share + stamp
overage rule.

**Components:**
- `netlify/lib/shares.ts` — `recordShare(opts)` implementing the
  transaction in Architecture; `precheckShare(opts)` doing the
  read-only decision; `monthKeyFor(timezone, instant)` helper for
  IANA-TZ month derivation; `isValidIanaTimezone(tz)` validator.
- `netlify/lib/stamps.ts` — extend `DebitStampOptions` to include
  optional `reason:'send'|'share'` (default `'send'` for
  backward-compat). Thread it through to the
  `stamp_transactions.reason` insert.
- `netlify/functions/shares/precheck.ts` — `POST
  /api/shares/precheck`. Authed; validates body; calls
  `precheckShare`; returns the discriminated union.
- `netlify/functions/shares/confirm.ts` — `POST
  /api/shares/confirm`. Authed; validates body; calls
  `recordShare`; returns the result.
- `test/shares-record.test.ts`, `test/shares-precheck.test.ts`,
  `test/shares-confirm.test.ts` — unit + integration coverage
  for the ACs in this phase.

**Acceptance Criteria:** `share-quota.AC3.1`, `share-quota.AC3.2`,
`share-quota.AC3.3`, `share-quota.AC3.4`, `share-quota.AC4.1`,
`share-quota.AC4.2`, `share-quota.AC4.3`, `share-quota.AC4.4`,
`share-quota.AC4.5`, `share-quota.AC4.6`, `share-quota.AC5.1`,
`share-quota.AC5.2`.

**Dependencies:** Phase 1, Phase 4 (needs authed sessions).

**Done when:** All listed ACs have passing tests; concurrent
double-confirm test demonstrates one row + one debit at most.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Client share flow
**Goal:** Wire the post page through precheck + confirm with the
new UX states.

**Components:**
- `src/state.ts` — `State.ShareDrawing(state, post)` helper
  encapsulating the precheck → branch → (confirm) → open-share-sheet
  pipeline. New signals: `shareDialog:Signal<ShareDialogState|null>`,
  `shareInFlight:Signal<boolean>`, `shareError:Signal<string|null>`.
  `canShare` computed signal collapses to `isAuthed`.
- `src/components/confirm-stamp-dialog.ts` — modal: "This will
  use 1 stamp. Continue?" with Cancel and Confirm buttons.
- `src/components/no-stamps-message.ts` — inline message with a
  link to `/pricing` for the `blocked` path.
- `src/routes/post.ts` — Share button calls `State.ShareDrawing`
  instead of `sharePublicPost`. The existing share-fallback UI
  continues to handle the case where `navigator.share` is not
  available — it now runs after the server confirm has succeeded.

**Acceptance Criteria:** `share-quota.AC3.5`, `share-quota.AC3.6`,
`share-quota.AC3.7`, `share-quota.AC6.1`, `share-quota.AC6.2`,
`share-quota.AC6.3`.

**Dependencies:** Phase 5.

**Done when:** Manual test: free share opens share sheet
immediately; second share in same month shows confirm dialog;
confirming debits a stamp and opens share sheet; cancelling
makes no server write; zero-stamps + used-free shows the
no-stamps message with the pricing link.
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Pricing page rewrite
**Goal:** Replace the two-tier subscription pricing page with the
single-tier + stamp-packs page.

**Components:**
- `src/routes/pricing.ts` — single info section ("Sign in (free)")
  describing the included features and the 1-free-share-per-month
  rule, plus a stamp packs section listing `10_stamps` ($5) and
  `25_stamps` ($10), each with a Buy button that opens the
  existing `BuyPackModal`.
- `src/routes/pricing.css` — adjust layout for the new structure
  (single info card + pack list). No new design tokens.

**Acceptance Criteria:** `share-quota.AC7.1`, `share-quota.AC7.2`.

**Dependencies:** Phase 2, Phase 3.

**Done when:** `/pricing` renders the new structure; clicking
either Buy button opens the BuyPackModal seeded with the right
pack; no references to subscription tier remain in the route.
<!-- END_PHASE_7 -->

<!-- START_PHASE_8 -->
### Phase 8: Test cleanup and final verification
**Goal:** Sweep removed/renamed code paths out of the test suite;
confirm end-to-end behavior.

**Components:**
- Remove tests asserting subscription gating
  (`us016-paid-gating.test.ts` and similar).
- Remove tests asserting email/passkey/magic-link auth flows.
- Verify `verifyStampInvariants` still passes with `share` rows
  in `stamp_transactions`.
- Final `npm test && npm run lint` clean run.

**Acceptance Criteria:** `share-quota.AC8.1`.

**Dependencies:** All prior phases.

**Done when:** Full suite passes; lint is clean; no orphan
references to removed symbols anywhere in the repo.
<!-- END_PHASE_8 -->

## Additional Considerations

**Precheck staleness vs confirm authority.** Between precheck
(`free`) and confirm, a concurrent confirm from another tab could
claim the free slot. The confirm transaction's
`SELECT … FOR UPDATE` re-checks under lock, so the second one
transparently degrades to the paid path (or to `blocked`). The
client treats `precheck` as advisory and the `confirm` response as
authoritative. The dialog UX accommodates this because the
discriminated union covers all outcomes uniformly.

**Timezone manipulation.** The user supplies their IANA timezone
per request. A motivated user can change their device TZ to claim
a second free share at the month boundary. This is by design and
matches the brainstormed intent ("free share per calendar month in
the user's *current* browser TZ"). Cost is bounded — at most one
extra free share around each rollover, only if the user notices
they can do this.

**Append-only `share_events`.** `share_events` rows are immutable
once written, mirroring `stamp_transactions`. The paid-share
linkage lives on `stamp_transactions.reference_id`, not on
`share_events`, so we never need to UPDATE a `share_events` row
after insert.

**Reusing `debitStamp` for shares.** Adding a `reason:'share'`
parameter to `debitStamp` is preferable to writing a parallel
`debitStampForShare` function: the existing
`InsufficientStampsError`, transactional FIFO/priority lot
selection, and invariant accounting are all reused for free. The
only call site we touch is the share-confirm path.

**Escape hatch on the OAuth library.** The revived OAuth code is
hand-rolled (PKCE + DPoP + PAR) following the prior commit
`34edfab`. If implementation hits non-trivial spec drift versus
the current atproto OAuth profile, fall back to
`@atproto/oauth-client-node`. The session-cookie boundary is
narrow enough that swapping the library underneath does not leak
into the rest of the system.

**Pre-release wipe is destructive.** Migration 0010 truncates all
user-scoped tables and drops columns. This is only acceptable
because the app is pre-release. Once we are post-release this
migration is a one-shot — the design does not provide a forward
migration path for legacy email/passkey users.
