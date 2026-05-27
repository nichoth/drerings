# drerings Development Guidelines

Last updated: 2026-05-21

## Active Technologies
- TypeScript 5.8 (ES2022, ESM), Node >=20.19 + `@netlify/functions` ^4.1.8 (v1 `Handler` (005-fix-auth-login-404)
- Postgres (Netlify DB) — schema unchanged by this fix (005-fix-auth-login-404)
- TypeScript 5.8 (ES2022, ESM), Node >=20.19 + `@netlify/functions` ^4.1.8 (v1 `Handler`, (006-fix-auth-login-404)
- TypeScript 5.8 (ES2022, ESM), Node ≥20.19 + Vite 7, `@preact/preset-vite`, (007-split-dev-ports)
- N/A (dev infrastructure change; no DB touch) (007-split-dev-ports)
- TypeScript 5.8 (ES2022, ESM), Node ≥20.19 + `@netlify/database` ^1.0.0, (008-fix-db-connection)
- Postgres (Netlify DB in prod; per-developer Postgres in (008-fix-db-connection)

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
    postcards.ts         postcard CAS state-machine + bounce refund
    billing.ts           Autumn checkout + refund attempt logging
    session.ts           drerings_auth cookie (HMAC-signed)
    rate-limit.ts        checkAndIncrement + 429 response helpers
    http.ts              json() (defaults Cache-Control private, no-store)
  database/migrations/   Numbered, append-only SQL migrations

test/                    Vitest (us0XX-*.test.ts maps to a user story)
```

## Commands

```sh
npm test && npm run lint
```

## Local development

Run `npm start`. It starts two processes concurrently via
`concurrently --kill-others`:

1. `vite` on port 8888 — the SPA and the dev front door (the
   browser talks to this).
2. `netlify functions:serve --port=9999` — the Functions
   runtime. Not directly user-visible.

Browse to **`http://127.0.0.1:8888`**, NOT `localhost:8888` —
atproto OAuth uses 127.0.0.1 for its loopback client and cookies
set on 127.0.0.1 are not visible to `localhost`.

Vite's `server.proxy` (in `vite.config.js`) forwards `/api/*`
and `/.well-known/oauth-client-metadata.json` to `:9999`, mirroring
the two `[[redirects]]` entries in `netlify.toml`. Both the
redirect table and the proxy use a single splat (`/api/* →
/.netlify/functions/:splat`) — to add a new endpoint, create
`netlify/functions/<kebab-name>.ts` and call `/api/<kebab-name>`
from the SPA. URLs never have more than one segment after `/api/`;
nested URL paths like `/api/foo/bar` will 404 by design. Path
parameters (e.g. `/api/stamps-refund/:lot_id`) are fine — the
splat passes them through to the function.

`server.strictPort: true` — if `:8888` is taken, Vite exits
loudly. To override Vite's port, set `PUBLIC_URL` to the
matching origin (otherwise OAuth will redirect to the wrong
port). To override the functions port, change BOTH the
`--port=9999` flag in the `start` script and the `target` in
`vite.config.js` — a mismatch surfaces as `ECONNREFUSED` on
every `/api/*` call.

`netlify dev` is no longer the dev front door; the
`[dev]` block in `netlify.toml` has been removed. Don't
re-introduce it.

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
- `GET /api/auth-login?handle=<handle>`
  (`netlify/functions/auth-login.ts`): 302 to the user's PDS.
- `GET /api/auth-callback`
  (`netlify/functions/auth-callback.ts`): exchanges code, upserts
  the user (`did`, `handle`), sets the `drerings_auth` cookie.
- `POST /api/auth-logout`
  (`netlify/functions/auth-logout.ts`): revokes the atproto session
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

- `POST /api/shares-precheck` (`netlify/functions/shares-precheck.ts`):
  authed, read-only. Body: `{ drawing_id, timezone, idempotency_key }`.
  Returns one of `PrecheckResult`:
  - `{ type: 'free', month_key }` — user has their free share this month.
  - `{ type: 'paid', stamps_balance, month_key }` — free used, balance
    available; client must call `confirm` to debit.
  - `{ type: 'blocked', reason: 'no_free_no_stamps',
      stamps_balance: 0, month_key }`.
  - `{ type: 'reused', was_free }` — idempotency hit, same drawing.
- `POST /api/shares-confirm` (`netlify/functions/shares-confirm.ts`):
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
- **0014 `relax_share_events_cascade`**: drops the BEFORE DELETE
  trigger on `share_events` so account-deletion cascades work; the
  BEFORE UPDATE append-only trigger is preserved.
- **0015 `stamp_lots_checkout_unique`**: partial UNIQUE index on
  `stamp_lots(autumn_checkout_id)` WHERE
  `source IN ('purchase','gift_received') AND autumn_checkout_id IS
  NOT NULL`. This is the *correctness* gate against double-credit on
  concurrent Autumn webhook retries — `hasStampCheckout` is now just a
  fast-path optimization, not load-bearing. Grants
  (`source='grant'`) have `autumn_checkout_id IS NULL` and are
  unaffected.
- **0016 `postcards_debiting_state`**: extends
  `postcards.status` CHECK to allow `'debiting'`. See the postcards
  state-machine notes below.
- **0017 `rate_limit_buckets`**: `(key TEXT PRIMARY KEY, window_start
  TIMESTAMPTZ, count INTEGER)` backing
  `netlify/lib/rate-limit.ts`. Buckets are not pruned automatically;
  a cleanup job MAY delete rows older than 24h but is not required for
  correctness. To manually clear a stuck bucket, `DELETE FROM
  rate_limit_buckets WHERE key = ...` — the next request reinserts.

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

### Post-0010 cleanups already shipped (do not regress)

**Stamps gift queries (shipped pricing-adjust):**
Four queries in `netlify/lib/stamps.ts` previously selected
`users.email` which migration 0010 dropped. All four now use
`users.handle`: `listSentGiftsForSender`, `refundSentGiftStampLot`,
`refundExpiredPendingGifts`, `refundExpiredPendingGift`. Email is
synthesized as `${handle}@bsky.social` where required for downstream
APIs (matches `billing.ts`). Related types (`SentGiftSummary`,
`ExpiredPendingGiftRow`) and UI consumers were updated.

**Gift recipient lookup (shipped payment-hardening Phase 1):**
The dead `findGiftRecipient(users.email)` was removed and replaced
with `lookupGiftRecipient(identifier)`. See the dedicated section
above for the new contract. All three us017 gift test files are
un-skipped and passing.

**Share_events deletion constraint (shipped pricing-adjust):**
Migration 0011 declared ON DELETE CASCADE FKs but had a BEFORE
DELETE trigger that rejected all deletes, blocking
`deleteAccountData`. Migration 0014 drops the BEFORE DELETE trigger
while keeping BEFORE UPDATE to preserve append-only semantics on the
update path.

### Gift recipient resolution (replaces the prior email lookup)

`findGiftRecipient` is gone. The replacement is
`lookupGiftRecipient(identifier)` in `netlify/lib/billing.ts`:

- Returns `GiftRecipient = { id, handle, did } | null`.
- DID is detected by prefix (`did:`, case-insensitive on the prefix
  test) and queried *with the original case preserved* — the column
  is case-sensitive.
- Handles are lowercased before query and matched via
  `lower(handle) = $1`. The gifts checkout handler's
  `normalizeRecipient` mirrors this: lowercase handles but never
  lowercase a DID.
- Autumn checkout metadata now carries `gift_sender_handle` and
  `gift_recipient_handle` (NOT `gift_sender_email` /
  `gift_recipient_email`). The webhook reads these handle keys.
- The pending-gift path still uses
  `gift_pending_recipient_email`.
- Where a recipient email is required (Resend "to" address on the
  gift-received notification), synthesize as
  `${handle}@bsky.social` (matches the `customer_data.email` pattern
  in `createCheckoutSession`).

### Postcards (state machine + idempotent bounce refund)

`POST /api/postcards-send` and `POST /api/webhooks-resend` env vars
unchanged: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
`RESEND_WEBHOOK_SECRET`. The three refund-attempt error classes in
`billing.ts` (`InFlightRefundAttemptError`,
`OrphanedRefundAttemptError`, `AmbiguousRefundAttemptError`) still
gate the operator runbook.

**State machine (`postcards.status`, migration 0016):**

```
queued ──CAS──► debiting ──► sent
              │            └─► failed_refunded
              └─ rollback ─► queued     (on InsufficientStampsError)
```

- The send handler CASes `queued → debiting` via
  `transitionPostcardToDebiting` *before* calling `debitStamp`. This
  closes the prior 10-minute "resurrection" double-debit window.
- On `InsufficientStampsError` after a successful CAS, the handler
  calls `rollbackDebitingToQueued` so the idempotency_key remains
  retryable after the user tops up.
- `attachLotAndMarkSent` and `markFailedRefunded` are both scoped
  `WHERE status = 'debiting'` — they no-op (zero rows updated, no
  error) against any other state. They are *not* general-purpose
  setters; they are the completion arms of the CAS holder.
- Reused 'debiting' rows always return 409 `send_in_progress`
  regardless of age. There is no time-based escape hatch from
  'debiting'; the only exits are the holder's completion paths or
  the operator sweep documented in README ("Sweeping stale
  'debiting' postcards").

**Bounce refund (Resend webhook):**

`refundPostcardBounce(postcardId)` in `netlify/lib/postcards.ts` is
the single entry point for bounce refunds. It runs CAS + refund in
one transaction:

1. `UPDATE postcards SET status='failed_refunded' WHERE id=$1 AND
   status IN ('sent','debiting') AND lot_id IS NOT NULL RETURNING
   sender_id, lot_id`
2. If zero rows, classify and return
   `{ refunded:false, reason:'already_refunded'|'not_sent' }`.
3. Else call `refundFailedSend({ ..., client })` reusing the open
   client, then COMMIT. Returns `{ refunded:true, balanceAfter }`.

This is idempotent under Svix retries — concurrent attempts have
exactly one winner via the CAS. `handleResendEvent` MUST call this
orchestrator rather than composing `markFailedRefunded` +
`refundFailedSend` itself (the bare pair is no longer atomic under
the tightened `WHERE status='debiting'` scope on
`markFailedRefunded`).

**Idempotent Autumn webhook credit (migration 0015):**

- `creditStampLot` and `creditGiftStampLot` raise
  `DuplicateStampCheckoutError` on Postgres 23505 from the partial
  UNIQUE index. They do NOT return a "duplicate" result variant —
  callers must catch the thrown error.
- `applyStampCheckout` (in `billing.ts`) catches it and maps to the
  existing webhook outcome `{ handled:true, stamp_purchase:
  'already_credited' }`. The advisory `hasStampCheckout()` check
  remains as a fast-path optimization but is no longer load-bearing
  for correctness — the unique index is.

**Shared-transaction refund:** `refundFailedSend` accepts an optional
`client?: DatabaseClient` (mirrors `debitStamp(client?)`). When
passed, the refund runs INSIDE the caller's transaction and does NOT
issue BEGIN/COMMIT/ROLLBACK or release the client. This is what
`refundPostcardBounce` uses to keep the CAS + refund atomic.

### HTTP response defaults

`json()` in `netlify/lib/http.ts` defaults `Cache-Control` to
`private, no-store`. This applies to *all* JSON API responses by
default — do not weaken it without thought. The opt-out is
`json(status, body, { cacheControl: '...' })`. The only current
opt-out is `/.well-known/oauth-client-metadata.json`, which is
deliberately cacheable so the user's PDS can reuse the document.

`netlify.toml` emits HSTS (2y, includeSubDomains, preload),
X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin,
a broad Permissions-Policy disable list, and a
Content-Security-Policy *report-only* (default-src 'self'; img-src
'self' data: blob:; frame-src https://github.com; frame-ancestors
'none'; ...). CSP graduates to enforce mode after one staging week
with zero violations — see comment block in `netlify.toml`.

CORS is intentionally NOT configured. The SPA is same-origin. Never
re-add `Access-Control-Allow-Origin: *` with
`Access-Control-Allow-Credentials: true` — that combination was
removed in Phase 5 and is a known auth-exfiltration footgun. If a
future product requirement needs cross-origin clients, gate on an
allowlist via an Edge Function.

### Rate limiting (`netlify/lib/rate-limit.ts`)

Public surface: `checkAndIncrement(key, max, windowSeconds)`,
`getClientIp(event)`, `rateLimitResponse(check, max, windowSeconds)`.

Key convention: `user:{user_id}:{endpoint}` for authed endpoints,
`ip:{ip_addr}:{endpoint}` for unauthed. `getClientIp` prefers
`x-nf-client-connection-ip` (Netlify-native) over the first hop of
`x-forwarded-for`, falling back to `'unknown'`.

`checkAndIncrement` is a single-statement atomic INSERT ... ON
CONFLICT DO UPDATE against `rate_limit_buckets`; window rollover is
folded into the CASE expression and relies on Postgres'
transaction_timestamp() stability within one statement. Do not split
it into separate SELECT/UPDATE.

429 responses (via `rateLimitResponse`) carry `Retry-After`,
`RateLimit-Policy`, and `RateLimit` headers (IETF draft format).

Current limits and gate placement (AFTER session check / IP extract,
BEFORE body validation):

- `/api/auth-login` — 10/min per IP
- `/api/postcards-send` — 30/min per user
- `/api/shares-confirm` — 30/min per user
- `/api/billing-checkout` — 5/min per user
- `/api/stamps-gifts-checkout` — 5/min per user

To unstick a user/IP, `DELETE FROM rate_limit_buckets WHERE key =
'user:<id>:postcards/send'` (or the matching key) — the next request
re-inserts a fresh window.

## Recent Changes
- 008-fix-db-connection: Added TypeScript 5.8 (ES2022, ESM), Node ≥20.19 + `@netlify/database` ^1.0.0,
- 007-split-dev-ports: Added TypeScript 5.8 (ES2022, ESM), Node ≥20.19 + Vite 7, `@preact/preset-vite`,
- 006-fix-auth-login-404: Added TypeScript 5.8 (ES2022, ESM), Node >=20.19 + `@netlify/functions` ^4.1.8 (v1 `Handler`,
