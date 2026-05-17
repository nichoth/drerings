# Phase 1: Wire stamps to a real postcard-send path

**Goal:** Make a stamp actually get debited when a user sends a drawing to a recipient. Today the accounting machinery (`debitStamp`, `refundFailedSend`) exists but has zero callers; the UI's "1 stamp" label sits next to a Publish button that posts to Bluesky (correctly free) without touching stamps.

**Architecture:** Add a new `POST /api/postcards/send` Netlify Function that owns the design's 8-step send flow (debit → blob → email → on-failure refund). Split the existing `SendRoute` UI into two distinct actions — a free "Publish to Bluesky" button and a paid "Send postcard" form that collects a recipient email. The Bluesky-posting path stays untouched and free. Resend is the email transport; the same `@netlify/blobs` store used for drawings holds the PNG that gets attached.

**Tech Stack:** Existing — `@netlify/functions`, `@netlify/blobs`, `@netlify/database`, Resend HTTP API, Preact + @preact/signals + htm. No new dependencies.

**Scope:** Phase 1 of 4 (remediation plan).

**Codebase verified:** 2026-05-16

**Design source:** `/Users/nick/code/drerings/docs/pricing.md` lines 125–163 (send flow + what counts as a failed send) and lines 251–256 (sender UI surfaces).

---

## Acceptance Criteria Coverage

The design doesn't number ACs; these are derived from the cited lines.

### stamps.AC1: Postcard send debits exactly one stamp on success
- **stamps.AC1.1 Success:** A user with `stamps_balance >= 1` who POSTs a valid `(drawing_id, recipient_email)` to `/api/postcards/send` receives `200 { id, balance_after }`. After the call, the user's `stamps_balance` is decremented by 1, the consumed lot's `remaining_count` is decremented by 1, and a `stamp_transactions` row exists with `reason='send'`, `delta=-1`, and `reference_id` equal to the postcard id.
- **stamps.AC1.2 Idempotent on retry:** Sending the same `(drawing_id, recipient_email, idempotency_key)` twice debits at most one stamp and returns the same postcard id both times. (The design doesn't require this; we add it because mobile networks retry.) Stale-row resurrection: a row stuck in `status='queued'` for more than 10 minutes (the upper bound for a Netlify Function timeout + slack) is treated as abandoned — the next retry adopts it and proceeds with a fresh debit attempt rather than returning `409 send_in_progress` forever.

### stamps.AC2: Insufficient balance refuses cleanly
- **stamps.AC2.1 Failure:** A user with `stamps_balance = 0` who POSTs to `/api/postcards/send` receives `402 { error: 'insufficient_stamps' }`. No `stamp_transactions` row is written, no email is sent, no blob is written.
- **stamps.AC2.2 Concurrent debit safety:** Two simultaneous `/api/postcards/send` calls on a user with `stamps_balance = 1` result in exactly one `200` and one `402` — never two successes, never a negative balance. (Design line 122–123.)
- **stamps.AC2.3 No subscription paywall:** A user with `subscription_status='free'` and `stamps_balance >= 1` can successfully send a postcard. The `isPaid()` check used by `POST /api/posts` (netlify/functions/posts.ts:42) is **not** applied to this endpoint. Stamps are the paywall — anyone with stamps can send. (Design lines 14–18, 45.)

### stamps.AC3: Synchronous delivery failure refunds the stamp
- **stamps.AC3.1 Blob write fails:** If the `@netlify/blobs` write throws, the response is `502 { error: 'send_failed' }`, the lot's `remaining_count` is restored, the user's `stamps_balance` is restored, and a `stamp_transactions` row exists with `reason='failed_send_refund'`, `delta=+1`. (Design line 155.)
- **stamps.AC3.2 Resend rejects synchronously:** If Resend returns a non-2xx (malformed `to`, auth failure, etc.) the same refund path runs and the response is `502 { error: 'send_failed' }`. (Design line 156.)
- **stamps.AC3.3 Refund preserves audit trail:** The original `reason='send'` row is NOT deleted or updated; instead a new `reason='failed_send_refund'` row is appended (per the design's append-only invariant, line 95).

### stamps.AC4: Bluesky publish stays free
- **stamps.AC4.1 No debit on publish:** Existing `POST /api/posts` continues to publish without calling `debitStamp` — the new send path is additive. (Design lines 215–224, already covered by `test/us024-bluesky-free-posting.test.ts`; we add a regression test that asserts the misleading "1 stamp" label on the Publish button is gone.)

### stamps.AC5: UI lets the user send a postcard
- **stamps.AC5.1 Recipient form + success state:** `SendRoute` shows a recipient email input and a "Send postcard" button alongside the existing "Publish" button. Submitting calls `POST /api/postcards/send` with the drawing id, the recipient email, and a generated idempotency key. On `200`, the form is replaced by a success panel showing "Sent to <recipient_email>. <balance_after> stamps remaining." with a "Send another" button. The route does NOT navigate to `/post/<id>` — postcard ids are uuids and `/post/` parses integers.
- **stamps.AC5.2 Insufficient-stamps flow:** When the API returns `402 insufficient_stamps`, the UI opens the existing `BuyPackModal` instead of showing a raw error. (Design line 253: "Buy modal triggered ... automatically when a send is attempted with a zero balance.")
- **stamps.AC5.3 Failed-send notification:** When the API returns `502 send_failed`, the UI shows a clear inline message including "your stamp has been refunded." (Design line 255.)
- **stamps.AC5.4 Cost indicator:** The "1 stamp" indicator appears next to the **Send postcard** button only, not the Publish button.

---

## Codebase findings to encode into this phase

Verified during audit + spot-checks (2026-05-16):

- `netlify/lib/stamps.ts:689–763` defines `debitStamp(options:{userId, referenceId?})` returning `{lotId, balanceAfter}` and throwing `InsufficientStampsError` on empty balance.
- `netlify/lib/stamps.ts:765–821` defines `refundFailedSend(options:{userId, lotId})` returning the same shape. Neither has a production caller today.
- `netlify/lib/drawings.ts` already stores PNGs in the `@netlify/blobs` `'drawings'` store via `netlify/lib/drawing-images.ts:putDrawingImage`. We do NOT need a separate blob for the postcard — the existing drawing PNG is what's attached.
- `netlify/lib/resend.ts` has Resend integrations for magic links / gift invites / refund notices but **no postcard delivery function**. We add one.
- `netlify/lib/session.ts` exposes `getSession(event):Session|null` returning the signed-in user. Use it the same way `netlify/functions/posts.ts:35` does.
- `netlify/lib/http.ts` provides `json(status, body)` and `parseJsonBody(event)`. Reuse these.
- `src/routes/send.ts:80–96` currently renders one Publish button (calls Bluesky) with a `<span aria-label="Sending this postcard costs 1 stamp">` next to it. That cost indicator is misleading and must move to the new postcard button.
- `src/components/buy-pack-modal.ts` exists; we'll trigger it from `SendRoute` on a 402 response.
- Existing tests use `vi.doMock('@netlify/database', …)` to swap in a mock pool (see `test/us004-refund-failed-send.test.ts:13–33`). Follow that pattern.
- Tests run under `npm test` (esbuild bundle + tapout) AND `npm run test:e2e` (vitest). The mocking pattern in existing US tests is vitest-style; new tests go in `test/us0NN-postcard-send-*.test.ts` and run under vitest.

**Do not change:**
- The `netlify/lib/stamps.ts` exports `debitStamp` / `refundFailedSend` signatures. The existing tests depend on them.
- The Bluesky publish path (`POST /api/posts`).
- The "1 stamp" label's wording — only move it.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add a Resend postcard-delivery function

**Verifies:** None (helper used by Task 2).

**Files:**
- Modify: `/Users/nick/code/drerings/netlify/lib/resend.ts`

**Implementation:**

Append a new exported function `sendPostcardEmail` to `netlify/lib/resend.ts`. The shape mirrors the existing `sendMagicLinkEmail`/`sendStampGiftEmail` exports already in the file — same `RESEND_API_KEY` env check, same `from` default, same `fetch('https://api.resend.com/emails', ...)` call, same throw-on-non-2xx pattern.

Inputs:

```typescript
export interface PostcardEmail {
    to:string
    senderHandle:string|null
    text:string
    altText:string
    pngBase64:string             // base64 (no data: prefix)
    postcardId:string            // for the X-Entity-Ref header
}
```

Body sent to Resend (https://resend.com/docs/api-reference/emails/send-email):

- `from`: `process.env.RESEND_FROM_EMAIL || 'Drerings <login@drerings.app>'` — match the address the existing `sendMagicLinkEmail` / `sendStampGiftEmail` use. A separate `postcards@` mailbox would require additional DKIM/SPF setup; reuse `login@` for now and revisit when the operator wants per-feature From addresses.
- `to`: `options.to`
- `subject`: ``${displayName(options.senderHandle)} sent you a Drering`` where `displayName(v) = v ? v.split('@')[0] : 'Someone'`. **Do NOT use the raw email in the subject line** — that's a sender-PII leak to the recipient. The existing `sendStampGiftEmail` uses the same `email.split('@')[0]` pattern (resend.ts:60-61).
- `html`: a minimal template — `<p>${escape(text)}</p>` plus a `<img cid:postcard>` reference if we use a content-id attachment, otherwise just the text and rely on the attachment.
- `text`: the plain `text` body.
- `attachments`: `[{ filename: 'postcard.png', content: pngBase64 }]` — Resend accepts base64 content under `content`.
- `headers`: `{ 'X-Entity-Ref-ID': postcardId }` — Resend echoes this back in bounce webhooks (Phase 2 uses it to correlate).

Escape `text` and `altText` with a small inline helper (or `String(x).replace(/[<>&"]/g, ...)`) before interpolating into HTML — these are user-supplied.

If `RESEND_API_KEY` is missing, throw `Error('RESEND_API_KEY is required')` to match the existing functions' behavior.

**Verification:**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no new errors.

Run: `npm run lint`
Expected: no new errors. Watch for the 80-column limit.

No runtime verification yet; Task 2 exercises the function end-to-end through the new endpoint's tests.

**Commit:** `feat(stamps): resend helper for postcard delivery`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Build `POST /api/postcards/send`

**Verifies:** stamps.AC1.1, stamps.AC2.1, stamps.AC2.2, stamps.AC2.3, stamps.AC3.1, stamps.AC3.2, stamps.AC3.3.

**Files:**
- Create: `/Users/nick/code/drerings/netlify/functions/postcards/send.ts`
- Create: `/Users/nick/code/drerings/netlify/lib/postcards.ts`
- Modify: `/Users/nick/code/drerings/netlify/database/migrations/` — add `0006_postcards/migration.sql` + `down.sql`
- Create: `/Users/nick/code/drerings/test/us0NN-postcard-send-api.test.ts`

**Implementation:**

1. **Migration `0006_postcards`** creates a `postcards` table to record each send attempt (success or refunded). Required because Phase 2's Resend bounce webhook needs to map a Resend `email_id` back to the original send (DID, lot id, drawing id). The table also lets the UI show "sent postcards" history later.

   Match the existing migration style (look at `netlify/database/migrations/0003_stamp_accounting/migration.sql` for column style — UUID PK via `gen_random_uuid()`, `created_at timestamptz NOT NULL DEFAULT now()`):

   ```sql
   -- All FK columns to users / drawings / stamp_lots are uuid (see
   -- netlify/database/migrations/0001_paid_accounts_schema/migration.sql:4,
   -- :36-37, and 0003_stamp_accounting/migration.sql:5 — every
   -- existing user_id and lot id is uuid, not text).
   CREATE TABLE postcards (
       id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       sender_id       uuid NOT NULL REFERENCES users(id)
                           ON DELETE CASCADE,
       drawing_id      uuid NOT NULL REFERENCES drawings(id)
                           ON DELETE CASCADE,
       recipient_email text NOT NULL,
       lot_id          uuid REFERENCES stamp_lots(id)
                           ON DELETE SET NULL,
       resend_email_id text,
       status          text NOT NULL CHECK (status IN (
           'queued', 'sent', 'failed_refunded'
       )),
       idempotency_key text,
       created_at      timestamptz NOT NULL DEFAULT now(),
       updated_at      timestamptz NOT NULL DEFAULT now()
   );

   -- Idempotency: a sender's repeated retries within ~10 minutes
   -- coalesce to one send.
   CREATE UNIQUE INDEX idx_postcards_idempotency
       ON postcards(sender_id, idempotency_key)
       WHERE idempotency_key IS NOT NULL;

   -- For Phase 2's bounce webhook to map back to the originating send.
   CREATE INDEX idx_postcards_resend
       ON postcards(resend_email_id)
       WHERE resend_email_id IS NOT NULL;
   ```

   `down.sql`:
   ```sql
   DROP INDEX IF EXISTS idx_postcards_resend;
   DROP INDEX IF EXISTS idx_postcards_idempotency;
   DROP TABLE IF EXISTS postcards;
   ```

   Confirm column types match existing migrations (all `uuid`, not `text`):
   ```bash
   grep -n "id uuid\|user_id uuid" netlify/database/migrations/0001_paid_accounts_schema/migration.sql
   grep -n "id uuid\|user_id uuid" netlify/database/migrations/0003_stamp_accounting/migration.sql
   ```
   Expected: every `id` and `user_id` line shows `uuid`. The SQL above already uses `uuid` for all FK columns.

2. **`netlify/lib/postcards.ts`** — a thin store module modeled on `netlify/lib/posts.ts`:

   Exports:
   All ID fields are TypeScript `string` because pg returns uuid columns as strings:

   ```typescript
   export interface CreatePostcardInput {
       senderId:string         // users.id (uuid as string)
       drawingId:string        // drawings.id (uuid as string)
       recipientEmail:string
       lotId:string|null       // stamp_lots.id; null pre-debit
       idempotencyKey:string|null
   }

   export interface PostcardRow {
       id:string               // postcards.id (uuid)
       sender_id:string        // uuid
       drawing_id:string       // uuid
       recipient_email:string
       lot_id:string|null      // uuid or null
       resend_email_id:string|null
       status:'queued'|'sent'|'failed_refunded'
       idempotency_key:string|null
       created_at:string
   }

   // Returns the existing row when (senderId, idempotencyKey) is already present.
   export async function findOrCreateQueuedPostcard (
       input:CreatePostcardInput
   ):Promise<{ postcard:PostcardRow, reused:boolean }>

   export async function attachLotAndMarkSent (
       postcardId:string,
       lotId:string,
       resendEmailId:string
   ):Promise<void>

   export async function markFailedRefunded (
       postcardId:string
   ):Promise<void>

   export async function getPostcardByResendEmailId (
       resendEmailId:string
   ):Promise<PostcardRow|null>     // for Phase 2 bounce webhook
   ```

   `findOrCreateQueuedPostcard` uses `INSERT ... ON CONFLICT (sender_id, idempotency_key) DO UPDATE SET sender_id = EXCLUDED.sender_id RETURNING ...` so we always get a row back and a clear signal of whether it was reused. (The DO UPDATE is a no-op write that makes RETURNING work; the partial unique index guarantees uniqueness only when `idempotency_key IS NOT NULL`.)

3. **`netlify/functions/postcards/send.ts`** is the handler. Pattern after `netlify/functions/posts.ts`:

   ```
   1. Reject non-POST → 405.
   2. session = getSession(event); if !session → 401.
   3. body = parseJsonBody(event); validate (drawing_id non-empty string,
      recipient_email RFC-5321-shaped, optional idempotency_key string).
      → 400 on missing/invalid.
   4. ownsDrawing = postStore.userOwnsDrawing(session.user.id, drawing_id);
      → 403 if not.
   5. Look up the drawing's blob_key by SELECTing from the drawings
      table (drawings.id, drawings.blob_key, drawings.text,
      drawings.alt_text — verified in 0001 migration). Then call
      `drawingImages.getDrawingImage(blob_key)` from
      `netlify/lib/drawing-images.ts:21`. No `getDrawingForSend` helper
      exists; use the drawing-images helper directly.
   6. { postcard, reused } = postcardStore.findOrCreateQueuedPostcard({...}).
      If reused AND postcard.status === 'sent' → 200 { id, balance_after }
        (the previous send succeeded — replay-safe).
      If reused AND postcard.status === 'failed_refunded' → 409
        { error:'send_previously_failed' } (don't silently re-attempt).
      If reused AND postcard.status === 'queued':
        - If created_at < now() - interval '10 minutes' → adopt the row
          (the previous attempt was abandoned by a function timeout or
          crash). Proceed to step 7. (AC1.2 stale-row resurrection.)
        - Otherwise → 409 { error:'send_in_progress' } (a parallel
          attempt is mid-flight).

   7. try {
        debit = await debitStamp({ userId: session.user.id,
                                   referenceId: postcard.id })
      } catch (err) {
        if (err instanceof InsufficientStampsError) {
            // Clean up the queued row so the user can retry after buying.
            await postcardStore.deleteIfQueued(postcard.id)
            return json(402, { error: 'insufficient_stamps' })
        }
        throw err
      }

   8. try {
          png = await drawingImages.getDrawingImage(drawingRow.blob_key)
          if (!png) throw new Error('drawing image missing')
          resendId = await sendPostcardEmail({
              to: recipient_email,
              senderHandle: session.user.email,
              text: drawingRow.text,
              altText: drawingRow.alt_text,
              pngBase64: Buffer.from(png).toString('base64'),
              postcardId: postcard.id
          })
          await postcardStore.attachLotAndMarkSent(
              postcard.id, debit.lotId, resendId
          )
          return json(200, {
              id: postcard.id,
              balance_after: debit.balanceAfter
          })
      } catch (sendError) {
          // Synchronous delivery failure - refund and surface.
          await refundFailedSend({
              userId: session.user.id,
              lotId: debit.lotId
          })
          await postcardStore.markFailedRefunded(postcard.id)
          console.error('postcard send failed', sendError)
          return json(502, { error: 'send_failed' })
      }
   ```

   Notes:
   - The `senderHandle` value is taken from `session.user.email`. If a `handle` field becomes available later, swap in `session.user.handle ?? session.user.email`.
   - `sendPostcardEmail` needs to return the Resend `id` field from the JSON response — Task 1 returns `void`; tighten it to `Promise<string>` (the Resend response shape is `{ id: 're_...' }`).
   - The "reused queued" 409 branch prevents an evil/buggy client from triggering parallel debits with the same idempotency key. The dedicated unique index on `(sender_id, idempotency_key)` enforces single-row.
   - `deleteIfQueued` removes the row only if `status='queued'` so we never delete a sent/refunded record. Add it to `postcards.ts`.

4. **Add the netlify.toml redirect.** `netlify.toml` already maps `/api/*` to `/.netlify/functions/:splat` (line 14–16), so the new function at `netlify/functions/postcards/send.ts` will resolve at `/api/postcards/send` automatically. No netlify.toml change needed; verify after the function is in place.

**Testing:**

Create `test/us0NN-postcard-send-api.test.ts`. Use the existing `vi.doMock('@netlify/database', ...)` pattern from `test/us004-refund-failed-send.test.ts`. Cover each AC:

- **AC1.1 success path:** mock DB to return a healthy lot, mock Resend `fetch` to return 200 with `{id:'re_test'}`, mock blob fetch to return a small Buffer, call handler with valid body, assert `200 { id, balance_after }`, assert `attachLotAndMarkSent` was called.
- **AC1.2 idempotent retry:** call handler twice with the same idempotency key, assert the second call returns the same `id` and `debitStamp` was called only once (via the mock's call count).
- **AC2.1 insufficient stamps:** mock `debitStamp` to throw `InsufficientStampsError`, assert `402 { error: 'insufficient_stamps' }`, assert no Resend call and no `attachLotAndMarkSent`.
- **AC2.2 concurrent debit safety:** This is hard to test purely as a unit test (it's a DB-level property). The existing `test/us003-debit-stamp.test.ts` already covers the concurrent debit race on `debitStamp` itself; in this test, add an assertion that the handler's failure mode on `InsufficientStampsError` is identical regardless of whether the error came from the WHERE-clause check (no lot) or the belt-and-suspenders check (zero balance) — i.e., still returns 402.
- **AC2.3 free user with stamps succeeds:** mock `getSession` to return a session whose `user.subscription_status === 'free'` and the user has stamp balance; assert the handler returns 200, NOT 402. Confirms the regression: `isPaid()` is never consulted on this code path. Add a corollary assertion that `isPaid` is not imported in `netlify/functions/postcards/send.ts` (grep the produced file in CI: `grep -L "isPaid" netlify/functions/postcards/send.ts` should match).
- **AC3.1 blob write fails:** mock `getDrawingImage` to reject with `new Error('blob unavailable')`, assert `502 { error: 'send_failed' }`, assert `refundFailedSend` was called with the correct `(userId, lotId)`, assert `markFailedRefunded` was called.
- **AC3.2 Resend rejects synchronously:** mock Resend `fetch` to return 422 with `{message:'invalid to'}`, assert same `502` + refund. (The `sendPostcardEmail` helper throws on non-2xx; the handler catches.)
- **AC3.3 audit trail:** spy on the `stamp_transactions` insert in the mock and assert two rows are inserted in the failure path — one `reason='send'`, one `reason='failed_send_refund'` — neither UPDATEs or DELETEs the other.

**Verification:**

Run: `npm run test:e2e -- us0NN-postcard-send-api`
Expected: all AC tests pass.

Run: `npm run lint && npx tsc -p tsconfig.json --noEmit`
Expected: no new errors.

Run the migration locally to confirm it applies:
```bash
npx netlify db migrations apply
npx netlify db query "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='postcards' ORDER BY ordinal_position"
```
Expected: the columns from the migration appear with the right types.

**Commit:** `feat(stamps): POST /api/postcards/send with debit + refund-on-failure`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Surface `sendPostcard` from `State`

**Verifies:** (wiring helper used by Task 4.)

**Files:**
- Modify: `/Users/nick/code/drerings/src/state.ts`

**Implementation:**

Add a new `State.SendPostcard` method modeled on the existing `State.PublishDrawing` (lines 647–676):

```typescript
export type PostcardSendResult =
    | { ok:true; id:string; balanceAfter:number }
    | { ok:false; reason:'insufficient_stamps'|'send_failed'|'other';
        message:string }

State.SendPostcard = async function (
    _state:AppState,
    input:{
        drawingId:string
        recipientEmail:string
        idempotencyKey:string
    }
):Promise<PostcardSendResult> {
    const response = await fetch('/api/postcards/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            drawing_id: input.drawingId,
            recipient_email: input.recipientEmail,
            idempotency_key: input.idempotencyKey
        })
    })

    const body = await maybeJson(response)

    if (response.status === 200) {
        return {
            ok: true,
            id: String(body?.id),
            balanceAfter: Number(body?.balance_after)
        }
    }
    if (response.status === 402) {
        return { ok: false, reason: 'insufficient_stamps',
                 message: 'You need more stamps to send.' }
    }
    if (response.status === 502) {
        return { ok: false, reason: 'send_failed',
                 message: typeof body?.error === 'string' ?
                     'The postcard didn’t go through — your stamp has been refunded.' :
                     'Send failed; your stamp has been refunded.' }
    }
    return { ok: false, reason: 'other',
             message: typeof body?.error === 'string' ?
                 body.error :
                 'Unable to send the postcard right now.' }
}
```

The return-shape distinction matters: the UI needs to dispatch on `reason` to decide whether to open the buy modal (insufficient_stamps), show the refund message (send_failed), or show a generic error. Keep all three branches mapped from HTTP status — do not parse error message strings.

Reuse the existing `maybeJson` helper that `PublishDrawing` already uses (it's defined nearby in `src/state.ts`).

Follow the project style: ternary operator on own lines, no space between colon and type, 80-column limit.

**Verification:**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no new errors.

Run: `npm run lint`
Expected: no new errors.

No tests yet — Task 4 exercises this via component tests.

**Commit:** `feat(stamps): State.SendPostcard client helper`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

<!-- START_TASK_4 -->
### Task 4: Split the SendRoute UI

**Verifies:** stamps.AC4.1, stamps.AC5.1, stamps.AC5.2, stamps.AC5.3, stamps.AC5.4.

**Files:**
- Modify: `/Users/nick/code/drerings/src/routes/send.ts`
- Modify: `/Users/nick/code/drerings/src/routes/send.css`
- Modify: `/Users/nick/code/drerings/test/us013-send-stamp-indicator.test.ts`
- Create: `/Users/nick/code/drerings/test/us0NN-postcard-send-route.test.ts`

**Implementation:**

The current `SendRoute` (src/routes/send.ts:11–97) renders a single Publish button with a "1 stamp" span next to it. After this task:

- The "Publish to Bluesky" button stays, calls `State.PublishDrawing`, and shows **no** stamp cost indicator (it's free per the design).
- A new "Send postcard" form appears below it: a single labeled email input + a "Send postcard" button + the "1 stamp" indicator next to that button.
- On submit, call `State.SendPostcard` with a fresh idempotency key generated via `crypto.randomUUID()` and cached in a `useSignal` so a quick double-click does not regenerate it. Reset the key once the response (any status) is received.
- On `ok:true` → stay on the send route and replace the form with a success panel showing "Sent to <recipient_email>. <balance_after> stamps remaining." plus a "Send another" button that re-mounts the form. (The existing `/post/<id>` path is for Bluesky public posts and parses `id` as a positive integer at `netlify/functions/posts.ts:96–102`; postcard ids are uuids and would 404 there. A dedicated `/postcards/<uuid>` history view is out of scope for this phase.) Optionally also call `state.refreshStampBalance()` or whatever existing helper updates the header indicator so the new `balance_after` shows up immediately in the header without a reload.
- On `reason:'insufficient_stamps'` → call `State.OpenBuyPackModal(state)` (defined at `src/state.ts:721`), which flips `state.buyPackModalOpen` to `true` — the same helper account.ts uses.
- On `reason:'send_failed'` → render the message inline in the same `<p role="alert">` that today shows publish errors.
- On `reason:'other'` → render the message inline.

CSS: nest the new form's selectors under `.route.send` (per CLAUDE.md: prefer nested selectors). Reuse existing color variables; do not introduce new ones.

Update `test/us013-send-stamp-indicator.test.ts`:
- The existing assertion `'Sending this postcard costs 1 stamp'` should now apply only to the **Send postcard** button group, not the Publish group. Update the test to query within the postcard group and assert the cost indicator is present there.
- Add a sibling assertion: the Publish button's group does NOT contain `'1 stamp'`. Use `queryByText` and `expect(...).toBeNull()`.

Add `test/us0NN-postcard-send-route.test.ts`:
- **AC5.1:** renders the recipient email input and Send postcard button.
- **AC5.2:** when `State.SendPostcard` resolves with `reason:'insufficient_stamps'`, the buy modal opens. Stub `State.SendPostcard` with `vi.fn` and assert the modal's open-signal flips to true (or the modal DOM appears, depending on how the existing component is structured).
- **AC5.3:** when `State.SendPostcard` resolves with `reason:'send_failed'`, the message "your stamp has been refunded" appears in `role="alert"`.
- **AC5.4 (negative):** the Publish button group does not include the "1 stamp" indicator.

**Verification:**

Run: `npm run test:e2e -- us013-send-stamp-indicator us0NN-postcard-send-route`
Expected: all tests pass, including the modified us013 assertion.

Run: `npm run lint && npx tsc -p tsconfig.json --noEmit`
Expected: no new errors.

Run: `npm start` in one terminal, open the app in a browser, navigate to a draft drawing's send page, and click both buttons by hand. Expected: Publish works as before; Send postcard either succeeds, opens the buy modal, or shows the refund message — depending on stamp balance.

**Commit:** `feat(stamps): split SendRoute into Publish + Send postcard`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Sanity-check regression suite + commit migration order

**Verifies:** stamps.AC4.1 (regression).

**Files:**
- (read only — no edits expected)

**Implementation:**

This is a verification-only task. The previous tasks created code and tests; this task confirms the whole change set hangs together before Phase 2 starts.

**Step 1: Confirm migration order**

Run: `ls netlify/database/migrations/`

Expected: `0001_paid_accounts_schema`, `0002_account_management`, `0003_stamp_accounting`, `0004_pending_gifts`, `0005_gift_reclaimed_reason`, `0006_postcards`. If `0006_postcards` is anywhere out of order, fix the naming.

**Step 2: Run the full backend test suite**

Run: `npm run test:e2e`
Expected: all tests pass, including:
- the two new test files from this phase,
- the existing `test/us024-bluesky-free-posting.test.ts` (must still pass — we didn't change the Bluesky path),
- the existing `test/us003-debit-stamp.test.ts` (must still pass — we didn't change `debitStamp`),
- the existing `test/us004-refund-failed-send.test.ts` (must still pass — we didn't change `refundFailedSend`).

**Step 3: Run the unit/bundle suite**

Run: `npm test`
Expected: passes. (This suite uses esbuild + tapout; some of the new vitest-specific assertions may not run here, which is fine — the tapout pipeline is for older tests.)

**Step 4: Lint + types**

Run: `npm run lint && npx tsc -p tsconfig.json --noEmit`
Expected: zero errors.

**Step 5: Confirm the user-visible behavior in a browser**

Run: `npm start`, navigate to `/send/<a-real-drawing-id>`, observe both buttons. Send a postcard to a personal email and confirm:
- The Resend email arrives with the PNG attached.
- The Stamps page (`/account/stamps` or equivalent) reflects a debit.
- Refreshing the send page after a successful send does not allow a second debit on the same idempotency key.

(This is manual verification because we can't automate inbox checks.)

**No commit required for this task** — verification only.
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

---

## Done when

- `POST /api/postcards/send` debits a stamp, sends the PNG via Resend, and refunds the stamp on synchronous failure.
- A user with zero stamps gets a 402 and the buy modal appears.
- The "Publish to Bluesky" button no longer carries a "1 stamp" indicator; Bluesky publish continues to NOT debit a stamp.
- The new `postcards` table exists with the unique-idempotency-key index.
- All new and existing tests pass under both `npm test` and `npm run test:e2e`.
- The behavior is manually verified in a browser end-to-end.

## Out of scope for Phase 1

- **Async bounce handling.** If Resend accepts the email synchronously but the recipient mailbox later hard-bounces, we do NOT refund yet. That's Phase 2.
- **DB-layer append-only enforcement.** Phase 3 adds the triggers.
- **Scheduled invariant checking.** Phase 3.
- **Autumn refund failure recovery.** Phase 4.
- **Postcard read receipts / "did they open it?"** Not in the design.
- **Sender history of sent postcards in the UI.** The `postcards` table now records them; the UI surface is a separate piece of work.
