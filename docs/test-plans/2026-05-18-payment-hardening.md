# Payment-Hardening Human Test Plan

Generated from the plan execution of
`docs/implementation-plans/2026-05-18-payment-hardening/`. Covers all
acceptance criteria classified as `human-verification` plus deploy-time
spot checks for ACs whose automated coverage uses mocks and would
benefit from real-Postgres or real-browser validation.

## Prerequisites

- Deploy preview built from `payment-hardening` is live; URL referred to
  below as `https://<deploy-preview>`.
- A dev/staging Postgres reachable as `$DATABASE_URL` with all migrations
  through `0017` applied. Console access via `psql "$DATABASE_URL"`.
- Local checkout with all dependencies installed.
- Environment variables present locally for any manual API hits:
  `SESSION_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
  `RESEND_WEBHOOK_SECRET`, `AUTUMN_SECRET_KEY` (or equivalent staging keys).
- `npm test && npm run lint` passing on the branch.
- Two browser profiles ready (Profile A: signed-in user; Profile B:
  signed-out or different atproto handle) for race / SOP checks.
- `curl`, `psql`, and Chromium-based browser DevTools available.

---

## Phase 5 — CORS lockdown (deploy-preview)

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | `curl -sI https://<deploy-preview>/api/whoami` | Response headers contain NO `Access-Control-Allow-Origin` and NO `Access-Control-Allow-Credentials`. Status is `401` or `200` depending on cookie. |
| 5.2 | `curl -sI -X OPTIONS https://<deploy-preview>/api/postcards/send -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST'` | No `Access-Control-Allow-Origin: *` and no `Access-Control-Allow-Credentials: true` are returned. (Netlify may return a generic 404/405 — that is acceptable; we are checking for the *absence* of permissive CORS.) |
| 5.3 (AC16.3) | In Profile A: sign in at `https://<deploy-preview>`, draw and send a postcard end-to-end. | Postcard sends successfully (200), stamp balance decreases by 1, confirmation visible in UI, `share_events` table updated. Same-origin SPA still works under the lockdown. |
| 5.4 (AC16.4) | Open DevTools on `https://example.com` (or any third-party origin). Paste `await fetch('https://<deploy-preview>/api/whoami', {credentials:'include'}).then(r => r.status)`. | Browser blocks the response in console with a CORS error. The promise rejects; no JSON body is exposed to the calling page. |

## Phase 6 — Security headers (deploy-preview)

| Step | Action | Expected |
|------|--------|----------|
| 6.1 (AC17.1–17.5) | `curl -sI https://<deploy-preview>/` and `curl -sI https://<deploy-preview>/index.html` | Each response includes: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`; `X-Frame-Options: DENY`; `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy: …camera=(), microphone=(), geolocation=()…`. |
| 6.2 (AC18.1) | `curl -sI https://<deploy-preview>/ \| grep -i content-security-policy` | Header named `Content-Security-Policy-Report-Only` is returned. Enforcing `Content-Security-Policy` header is NOT present (report-only first). |
| 6.3 (AC18.2–6) | Inspect the CSP value from 6.2. | Directives present: `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `img-src 'self' data: blob:`, `connect-src 'self'`, `frame-src https://github.com`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. |
| 6.4 (AC18 follow-up) | In Profile A with DevTools Console open, exercise the full SPA: sign in via atproto OAuth, navigate `/`, `/pricing`, `/account`, `/post/<id>`, send a postcard, open the BuyPack modal, then sign out. | Console shows ZERO CSP violation reports. (Report-only never blocks, but should not emit warnings either.) Note any directive that fires so it can be relaxed before the enforcing header ships. |
| 6.5 | `curl -sI https://<deploy-preview>/api/whoami` | Response includes `Cache-Control: private, no-store` (AC19.1) and the same security headers as 6.1. |
| 6.6 | Visit https://securityheaders.com/?q=<deploy-preview>. | Grade A or better; HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and a CSP header all detected. |

## Phase 2 / 4 / 7 — Real-Postgres race verifications

These ACs are mocked in vitest; the real-DB pass below is the
authoritative proof. Run against a non-production dev or staging DB.

| Step | Action | Expected |
|------|--------|----------|
| 7.1 (AC6.1) | `psql "$DATABASE_URL" -c "\\d+ stamp_lots" \| grep autumn_checkout` | Output includes `idx_stamp_lots_autumn_checkout_purchase` partial UNIQUE index `WHERE source IN ('purchase','gift_received')`. |
| 7.2 (AC6.2) | Apply migration 0015 twice: `psql "$DATABASE_URL" -f netlify/database/migrations/0015_*/migration.sql` (run twice). | Both runs return success; exit code 0 both times. |
| 7.3 (AC6.3) | Insert two grant lots: `INSERT INTO stamp_lots (user_id, source, count, autumn_checkout_id) VALUES ('<test-user-uuid>', 'grant', 1, NULL);` (run twice). | Both inserts succeed; partial index does not block NULL `autumn_checkout_id` rows. Cleanup. |
| 7.4 (AC7.3) | Two concurrent `creditStampLot` calls with the same `autumnCheckoutId`. | Exactly one call resolves with `{lotId, balanceAfter}`; the other rejects with `DuplicateStampCheckoutError`. `SELECT COUNT(*) FROM stamp_lots WHERE autumn_checkout_id='<id>'` returns 1; `users.stamps_balance` increases by exactly `count`. |
| 7.5 (AC8.3) | Same race for `creditGiftStampLot`. | Exactly one credit; recipient balance +`count`; one sender txn + one recipient txn; the second call rejects with `DuplicateStampCheckoutError`. |
| 7.6 (AC11.3) | Insert a `sent` postcard. Fire two concurrent `refundPostcardBounce(<id>)` calls. | One call returns `{refunded:true, balanceAfter:N+1}`; the other returns `{refunded:false, reason:'already_refunded'}`. `users.stamps_balance` increases by exactly 1. `stamp_transactions` shows exactly one `failed_send_refund` row. |
| 7.7 (AC13.1) | `psql "$DATABASE_URL" -c "\\d+ postcards"` | CHECK constraint on `status` includes `'debiting'`. |
| 7.8 (AC13.2) | Re-run migration 0016 twice. | Both runs succeed; CHECK matches expected value list. |
| 7.9 (AC13.3) | Snapshot row count + status histogram before applying 0016. Apply migration. Re-run histogram. | Counts identical; no rows lost or invalidated by the new CHECK. |
| 7.10 (AC15.3) | Insert a `queued` postcard with `created_at < now() - interval '10 minutes'`. Fire two concurrent `POST /api/postcards/send` calls (same idempotency_key) from Profile A. | One returns `200`; the other returns `409 send_in_progress`. `stamp_transactions` shows exactly one debit. Postcard ends in `'sent'`. |
| 7.11 (AC20.1) | `psql "$DATABASE_URL" -c "\\d+ rate_limit_buckets"` | Table exists with columns `key TEXT PRIMARY KEY`, `window_start TIMESTAMPTZ NOT NULL DEFAULT now()`, `count INTEGER NOT NULL DEFAULT 0`. Index on `window_start`. |
| 7.12 (AC20.2) | Re-run migration 0017 twice. | Both runs succeed; `CREATE TABLE IF NOT EXISTS` short-circuits the second run. |
| 7.13 (AC21.5) | In a Node REPL: `await Promise.all(Array.from({length: 25}, () => checkAndIncrement('test:race-1', 30, 60)));` against dev DB. | All 25 promises resolve. `SELECT count FROM rate_limit_buckets WHERE key='test:race-1';` returns exactly `25` — no lost updates. Cleanup. |

## Phase 7 — Rate-limit deploy-preview spot check

| Step | Action | Expected |
|------|--------|----------|
| 8.1 (AC23.1) | `for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code} " "https://<deploy-preview>/api/auth/login?handle=anyone.bsky.social"; done; echo` | Codes 1–10 are `302` (or whatever the under-limit code is). Calls 11–12 return `429`. The 429 response includes `Retry-After`, `RateLimit-Policy`, `RateLimit`, and body `{"error":"rate_limited"}`. |
| 8.2 (AC23.6) | Inspect a 429 from 8.1: `curl -i …`. | Headers `Retry-After: <seconds>`, `RateLimit-Policy: "default";q=10;w=60`, `RateLimit: "default";r=0;t=<seconds>`; body literal `{"error":"rate_limited"}`. |
| 8.3 (AC23.2) | Profile A: fire 35 rapid `POST /api/postcards/send` calls. | First 30 return `200`/`402`/`409` (business outcomes); calls 31–35 return `429`. Balance only decremented for the under-limit successes. |
| 8.4 (AC23.3) | Profile A: fire 35 rapid `POST /api/shares/confirm` calls. | First 30 follow normal precheck/confirm semantics; remaining return `429`. |
| 8.5 (AC23.4) | Profile A: fire 6 rapid `POST /api/billing/checkout` calls. | First 5 return checkout URLs; the 6th returns `429`. |
| 8.6 (AC23.5) | Profile A: fire 6 rapid `POST /api/stamps/gifts/checkout` calls (with valid recipient). | First 5 succeed (200/404 per business logic); the 6th returns `429`. |

---

## End-to-End: README-driven payment-hardening smoke test

Purpose: validate the staged behavior described in `README.md` against
the deploy preview, covering the headers/CORS/CSP/rate-limit overlay
introduced on this branch.

1. Open `https://<deploy-preview>` in Profile A. DevTools → Network:
   confirm the initial document response includes all Phase 6 security
   headers (matches Step 6.1).
2. Sign in via atproto OAuth: click "Sign in", enter a real handle,
   complete the PDS redirect. Verify on return that `drerings_auth`
   cookie is set with `HttpOnly; Secure; SameSite=Lax; Max-Age=1209600`.
   `GET /api/whoami` returns `{id, did, handle, stamps_balance}`.
3. Draw a quick test drawing in Profile A. Save it. Confirm it appears
   on the user's list.
4. Send a postcard from that drawing to a real (test) email address.
   - UI shows a "sent" state.
   - `POST /api/postcards/send` response carries
     `Cache-Control: private, no-store` and Phase 6 security headers.
   - DB: `SELECT status FROM postcards WHERE id='<id>'` is `'sent'`;
     `stamp_transactions` shows one `'send'` debit; `stamps_balance`
     decreased by 1.
5. From a second tab, retry the same drawing-send with the same
   idempotency key — expect a fast `200` with no new debit.
6. Trigger a hard-bounce simulation: send to an address Resend treats
   as `email.bounced` hard. Wait for the webhook. Verify:
   - Webhook responds 200; body indicates `refunded:true`.
   - Postcard status transitions to `failed_refunded`.
   - `stamp_transactions` adds one `'failed_send_refund'` row; balance
     restored by 1.
   - Re-deliver the same Svix payload (replay/curl with identical
     signature/headers); response is
     `{received:true, refunded:false, reason:'already_refunded'}`;
     balance does not double-credit.
7. Open `/pricing` in Profile A. Click Buy on the `10_stamps` card.
   Confirm:
   - The BuyPack modal opens with the 10-stamp option pre-focused.
   - Network shows the checkout request hit Autumn and returned a
     redirect URL.
   - Headers on the response include `Cache-Control: private, no-store`.
8. Simulate the post-purchase webhook by re-posting the Autumn
   `checkout.completed` payload twice using the same `checkout_id`.
   Expect:
   - First call: stamps credited, `stamp_lots` has one row with that
     `autumn_checkout_id`, transaction recorded.
   - Second call: webhook returns
     `{handled:true, stamp_purchase:'already_credited'}`. No new lot
     row, no balance change.
9. Open `/account`. Trigger the operator-runbook scenarios from
   `README.md` "Reconciling failed Autumn refunds":
   - Verify `autumn_refund_attempts` rows exist for refund attempts
     fired during this session.
   - Confirm no rows in `stamp_invariant_alerts`.
10. Sign out via the account menu. Confirm:
    - `POST /api/auth/logout` returns 200; `drerings_auth` cookie is
      cleared.
    - Subsequent `GET /api/whoami` returns 401.
    - Page refresh shows the signed-out home view.
11. From Profile B (different handle), repeat steps 2–4 with a
    third-party `Origin` header on one API request via DevTools
    `fetch` (Step 5.4 above) to confirm cross-origin requests remain
    blocked.
12. (Operator runbook smoke — Phase 4) Manually insert a stuck
    `'debiting'` row (`UPDATE postcards SET status='debiting',
    updated_at=now() - interval '20 minutes' WHERE id='<test-id>'`).
    Run the recovery SQL from the README section "Sweeping stale
    'debiting' postcards"
    (`UPDATE postcards SET status='queued', updated_at=now()
    WHERE status='debiting' AND updated_at < now() - interval '15
    minutes';`). Confirm the row returns to `'queued'`.

---

## Human Verification Required Summary

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC6.1–6.3 | DDL property of PG catalog | 7.1–7.3 |
| AC7.3 / AC8.3 | Real PG UNIQUE-index atomicity | 7.4, 7.5 |
| AC11.3 | Real PG row-locking under contention | 7.6 |
| AC13.1–13.3 | DDL property + data-shape invariant | 7.7–7.9 |
| AC15.3 | Real PG CAS race | 7.10 |
| AC16.3 / AC16.4 | Browser CORS/SOP enforcement | 5.3, 5.4 |
| AC17.1–17.5 | Headers emitted by edge, not by JS | 6.1, 6.6 |
| AC18.1–18.6 | CSP rendered to browser; verify in production | 6.2–6.4 |
| AC18 follow-up | Zero CSP violations in real SPA flow | 6.4 |
| AC20.1 / AC20.2 | DDL property + re-run safety | 7.11, 7.12 |
| AC21.5 | Real PG `ON CONFLICT DO UPDATE` atomicity | 7.13 |
| AC23.1–23.5 | End-to-end rate-limit on real deploy | 8.1, 8.3–8.6 |
| AC23.6 | Real 429 response shape from edge | 8.2 |
