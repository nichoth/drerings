# drerings Development Guidelines

Last updated: 2026-05-17

## Active Technologies

- TypeScript 5.8 (ES2022, ESM), Node >=20.19
- Preact 10, `@preact/signals` 2, `htm` (tagged-template JSX)
- Netlify Functions (esbuild bundler), `@netlify/database` (Postgres)
- atproto OAuth: `@atproto/oauth-client-node`, `@atproto/api`,
  `@atproto/identity`
- Resend HTTP API + Svix signature verification (postcards/bounces)
- Autumn (billing/checkout)

## Project Structure

```text
src/                     Preact SPA
  components/            UI components (htm)
  routes/                Route handlers
  state.ts               @preact/signals state + State.* helpers
  stamp-packs.ts         PACK_DEFINITIONS (only '10_stamps', '25_stamps')

netlify/
  functions/             HTTP handlers (each file = one endpoint)
    auth/                login, callback, logout (atproto OAuth)
    shares/              precheck, confirm
    postcards/           send
    webhooks/            resend (bounce handler)
    oauth-client-metadata.ts
  lib/                   Domain logic (importable by handlers)
    auth/atproto.ts      NodeOAuthClient factory
    auth/atproto-stores.ts  Postgres SessionStore + StateStore
    shares.ts            precheckShare, recordShare, monthKeyFor
    stamps.ts            debitStamp, creditStampLot, refunds, invariants
    billing.ts           Autumn checkout + refund attempt logging
    session.ts           drerings_auth cookie (HMAC-signed)
  database/migrations/   Numbered, append-only SQL migrations

test/                    Vitest (us0XX-*.test.ts maps to a user story)
```

## Commands

```sh
npm test && npm run lint
```

## Code Style

See user-level `~/.claude/CLAUDE.md` for TS/CSS conventions
(no-space `:type`, ternary style, `_variables.css`, nested CSS,
`batch()` around multi-signal sets).

## Auth, Shares & Pricing (added 2026-05-17)

Operator-facing docs live in `README.md` ("atproto OAuth", "Resend
Webhook", "Stamp invariant alerts", "Reconciling failed Autumn
refunds"). Skim those before touching auth or stamp-accounting code.

### atproto OAuth

The app authenticates exclusively via atproto OAuth — there is no
email/password, magic-link, or passkey path. Anything referencing
those was removed in migration 0010 and the Phase 2 cleanup.

Endpoints:

- `GET /.well-known/oauth-client-metadata.json`
  (`netlify/functions/oauth-client-metadata.ts`): client metadata
  document required by PDS.
- `GET /api/auth/login?handle=<handle>`
  (`netlify/functions/auth/login.ts`): 302 to the user's PDS.
- `GET /api/auth/callback`
  (`netlify/functions/auth/callback.ts`): exchanges code, upserts
  the user (`did`, `handle`), sets the `drerings_auth` cookie.
- `POST /api/auth/logout`
  (`netlify/functions/auth/logout.ts`): revokes the atproto session
  and clears the cookie.
- `GET /api/whoami` returns `{ id, did, handle, stamps_balance }`.

Cookie contract (`netlify/lib/session.ts`):

- Name: `drerings_auth` (renamed from prior session cookie).
- Payload (base64url JSON): `{ id, did, handle, issued_at }`.
- Signed: HMAC-SHA256 over the payload, using `SESSION_SECRET`.
- `HttpOnly; Secure; SameSite=Lax; Max-Age=14 days`.
- `getSession()` re-reads the user from Postgres on every call —
  do NOT trust cookie-only fields beyond `id/did/handle`.

`SessionUser` (in `netlify/lib/auth-store.ts`) now carries:
`id, did, handle, stamps_balance?, autumn_customer_id?`. The old
`email`, `subscription_status`, and `subscription_current_period_end`
fields are gone — assume nothing on the server reads them.

OAuth state and session storage lives in Postgres tables
`atproto_sessions` and `atproto_oauth_states` (migration 0013),
fronted by `netlify/lib/auth/atproto-stores.ts`.

### Shares (free quota + paid)

Domain entry point: `netlify/lib/shares.ts`. The flow is two endpoints
backing a precheck → confirm UX:

- `POST /api/shares/precheck` (`netlify/functions/shares/precheck.ts`):
  authed, read-only. Body: `{ drawing_id, timezone, idempotency_key }`.
  Returns one of `PrecheckResult`:
  - `{ type: 'free', month_key }` — user has their free share this month.
  - `{ type: 'paid', stamps_balance, month_key }` — free used, balance
    available; client must call `confirm` to debit.
  - `{ type: 'blocked', reason: 'no_free_no_stamps',
      stamps_balance: 0, month_key }`.
  - `{ type: 'reused', was_free }` — idempotency hit, same drawing.
- `POST /api/shares/confirm` (`netlify/functions/shares/confirm.ts`):
  authed, mutating. Same body. Returns `ConfirmResult`:
  - `{ type: 'recorded', was_free, stamps_balance }`.
  - `{ type: 'blocked', reason: 'no_free_no_stamps' }`.

Both endpoints map errors uniformly:

- 401 missing/invalid session
- 400 invalid body or invalid IANA timezone
- 404 drawing not owned by user (`postStore.userOwnsDrawing`)
- 409 `IdempotencyConflictError` — same `idempotency_key`, different
  `drawing_id`. This is the canonical conflict signal; surface it as
  a 409 from any new endpoint that calls `recordShare`.

`monthKeyFor(timezone, instant=now)` returns `YYYY-MM` in the supplied
IANA tz. `isValidIanaTimezone` is the gate before any DB read — never
pass an unvalidated tz into `Intl.DateTimeFormat` downstream.

### `recordShare` invariants

`recordShare` runs the paid path entirely inside one Postgres
transaction:

1. `BEGIN`
2. `SELECT id FROM users WHERE id = $1 FOR UPDATE` — serializes
   concurrent confirms for the same user (prevents two free shares,
   or two debits, in the same month).
3. Re-checks the monthly free count under the lock.
4. Free path: `INSERT INTO share_events (was_free=true)` then COMMIT.
5. Paid path: `INSERT INTO share_events (was_free=false) RETURNING id`,
   then `debitStamp({ ..., reason: 'share', client })` reusing the
   same transaction client.
6. On UNIQUE-violation (23505) on `(user_id, idempotency_key)`, throws
   `IdempotencyConflictError` so the handler maps to 409.

`debitStamp` (`netlify/lib/stamps.ts`) accepts:

- `reason?: 'send' | 'share'` — defaults to `'send'`. Recorded in
  `stamp_transactions.reason`.
- `client?: DatabaseClient` — optional caller-supplied PG client. When
  passed, `debitStamp` runs INSIDE the caller's transaction: it does
  NOT issue `BEGIN/COMMIT/ROLLBACK` and does NOT call `release()`.
  When omitted, it manages its own transaction (postcards path).

`StampTransactionReason` union now includes `'share'` (in addition to
prior `'gift_reclaimed'`). Migration 0012 extends the CHECK constraint
on `stamp_transactions.reason` to allow it. Mirror this in the
frontend `StampTransactionReason` union and `reasonLabel` in
`src/state.ts` if you add new reasons.

### Database

New migrations since 004-stamps:

- **0010 `pre_release_reset_for_atproto`**: destructive pre-release
  schema reset. Drops `users.email`, password, passkey, magic-link,
  and subscription columns; adds `did` and `handle`. Pre-existing
  passkey, magic_link, and subscription tables are dropped. This is
  a forward-only migration — there is no production data prior to it.
- **0011 `share_events`**: append-only table for share telemetry.
  Columns: `id, user_id, drawing_id, month_key, timezone, was_free,
  idempotency_key, created_at`. UNIQUE on `(user_id, idempotency_key)`.
  BEFORE UPDATE/DELETE triggers reject mutation.
- **0012 `stamp_tx_share_reason`**: extends
  `stamp_transactions.reason` CHECK to allow `'share'`.
- **0013 `atproto_session_state`**: `atproto_sessions` and
  `atproto_oauth_states` tables backing the OAuth stores.

Inherited invariants (still in force, from 0007/0008/0009):

- `stamp_transactions` is append-only — BEFORE UPDATE/DELETE triggers
  raise. Do not attempt to mutate rows from app code.
- `verifyStampInvariants` persists drift to `stamp_invariant_alerts`.
  New rows there mean an accounting bug shipped to prod.
- Every Autumn refund attempt is forensically logged to
  `autumn_refund_attempts` before the HTTP call.

### Pricing & stamp packs

- `PACK_DEFINITIONS` (`src/stamp-packs.ts`) has exactly two entries:
  `'10_stamps'` and `'25_stamps'`. The pack IDs ARE the Autumn product
  IDs — `getCheckoutProductId` is now an identity-ish mapping.
- `/pricing` renders one "Sign in (free)" card plus a stamps section
  with per-pack Buy buttons. Each button calls
  `State.OpenBuyPackModal(state, productId)`.
- `OpenBuyPackModal` accepts an optional `productId`; the
  `BuyPackModal` pre-focuses the matching pack button when
  `state.stampCheckoutProductId.value` matches.

### Client state (new bits in `src/state.ts`)

Signals:

- `shareDialog: Signal<ShareDialogState|null>` — `{ type: 'confirm',
  drawingId, idempotencyKey, stampsBalance }` or
  `{ type: 'blocked', message }`.
- `shareInFlight: Signal<boolean>`
- `shareError: Signal<string|null>`

Helpers (all on `State.*`):

- `State.ShareDrawing(state, drawing_id, openShareSheet)`: precheck
  then either fire native share (free / reused) or open the confirm
  dialog (paid / blocked). Used by `src/routes/post.ts`.
- `State.ConfirmShare(state, payload, openShareSheet)`: paid-path
  confirm.
- `State.CancelShareDialog(state)`: resets all three share signals
  in a `batch()`.

Components:

- `src/components/confirm-stamp-dialog.ts` — modal for the paid
  confirm step.
- `src/components/no-stamps-message.ts` — inline empty-state.

### Removed / dead code (do not re-introduce)

These were deleted in Phase 2 and Phase 8; if a feature seems to want
them back, reconsider the design rather than restoring:

- `netlify/lib/paid.ts` and all `isPaid` gating.
- `netlify/lib/passkeys.ts` and `@simplewebauthn/*` deps.
- `netlify/functions/auth/{magic-link,magic-link-callback}.ts`.
- `netlify/functions/auth/passkey/**`.
- `netlify/functions/account/{email,email-callback,passkeys}.ts`.
- `netlify/functions/billing/cancel.ts`.
- `State.StartCheckout`, `SessionUser.subscription_status`,
  `AccountDetails.subscription_current_period_end`.

### Known issues: gift checkout, share_events deletion

**Stamps gift queries (FIXED in pricing-adjust branch):**
Four queries in `netlify/lib/stamps.ts` previously selected
`users.email` which migration 0010 dropped. All four have been replaced
to use `users.handle`: listSentGiftsForSender, refundSentGiftStampLot,
refundExpiredPendingGifts, refundExpiredPendingGift. Email is
synthesized as `${handle}@bsky.social` where needed (matching billing.ts
pattern). Related types (SentGiftSummary, ExpiredPendingGiftRow) and UI
consumers updated.

**Share_events deletion constraint (FIXED in pricing-adjust branch):**
Migration 0011 declared ON DELETE CASCADE FKs but also had a BEFORE
DELETE trigger that rejected all deletes, blocking deleteAccountData.
Migration 0014 drops the BEFORE DELETE trigger while keeping BEFORE
UPDATE to preserve append-only semantics on the update path.

**Outstanding: findGiftRecipient**
`findGiftRecipient` (`netlify/lib/billing.ts:160`) still queries
`users.email`, which migration 0010 dropped. Three us017 gift tests
are skipped with a TODO pointing at this. Before re-enabling gift
checkout, replace the email lookup with a handle/DID resolver and
update the surrounding `createGiftCheckoutSession` metadata
(`gift_sender_email` currently synthesizes `${handle}@bsky.social`).

### Postcards (still active — see 004-stamps)

`POST /api/postcards/send` and `POST /api/webhooks/resend` are
unchanged. Env vars `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
`RESEND_WEBHOOK_SECRET` still required. The three refund-attempt
error classes (`InFlightRefundAttemptError`,
`OrphanedRefundAttemptError`, `AmbiguousRefundAttemptError`) in
`netlify/lib/billing.ts` still gate the operator runbook.
