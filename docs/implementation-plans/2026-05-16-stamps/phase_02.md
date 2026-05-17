# Phase 2: Async failure detection via Resend bounce webhook

**Goal:** Refund a stamp when a postcard is accepted by Resend but later hard-bounces from the recipient's mailbox. The synchronous failure path (Phase 1) covers the case where Resend rejects the request outright; this phase covers the asynchronous case where Resend accepts the email and the destination MTA returns a permanent failure minutes or hours later.

**Architecture:** Subscribe to Resend's `email.bounced` webhook (Resend uses Svix for signing, same scheme already in use for Autumn). A new `POST /api/webhooks/resend` Function verifies the signature, filters to permanent-bounce events, looks up the originating `postcards` row by the Resend `email_id` (already populated in Phase 1), and — if the row is in `status='sent'` — calls `refundFailedSend()` and transitions it to `status='failed_refunded'`. Idempotent on `(postcard_id, bounce)`: replaying the webhook never double-refunds.

**Tech Stack:** Existing — `@netlify/functions`, `@netlify/database`, hand-rolled Svix verification already in `netlify/lib/billing.ts`. No new dependencies.

**Scope:** Phase 2 of 4.

**Codebase verified:** 2026-05-16

**Design source:** `/Users/nick/code/drerings/docs/pricing.md` lines 152–163 (what counts as a failed send) and line 95 (append-only invariant — the refund must be a new transaction row, never a mutation).

---

## Acceptance Criteria Coverage

### stamps.AC6: Hard bounces refund the stamp asynchronously
- **stamps.AC6.1 Hard bounce → refund:** When Resend POSTs `email.bounced` with `data.bounce.type` in the permanent-failure set (`hard_bounce`, `general_bounce`, `permanent_failure`, exact strings per https://resend.com/docs/webhooks) and `data.email_id` matches an existing `postcards.resend_email_id` where `status='sent'`, the handler calls `refundFailedSend({userId: postcard.sender_id, lotId: postcard.lot_id})` and updates the postcard's status to `failed_refunded`. Response: `200 { received: true, refunded: true }`.
- **stamps.AC6.2 Transient bounce ignored:** When Resend POSTs `email.bounced` with `data.bounce.type` in the transient-failure set (`soft_bounce`, `mailbox_full`, `transient_failure`), the handler returns `200 { received: true, refunded: false, reason: 'transient' }` and does NOT call `refundFailedSend`. The original stamp stays debited (the recipient mailbox may accept it on retry).
- **stamps.AC6.3 Unknown email_id ignored:** When the `data.email_id` doesn't match any `postcards` row (e.g., a magic-link or gift-invite email's bounce — those use the same Resend project), the handler returns `200 { received: true, refunded: false, reason: 'not_a_postcard' }` and writes nothing.
- **stamps.AC6.4 Already-refunded postcards are no-ops:** When the matched postcard's `status` is already `failed_refunded` (replay of the same webhook, or sync refund from Phase 1 already happened), the handler returns `200 { received: true, refunded: false, reason: 'already_refunded' }`. No second `refundFailedSend` call, no second `stamp_transactions` row.
- **stamps.AC6.5 Other event types ignored:** When Resend POSTs `email.delivered`, `email.opened`, `email.complained`, `email.delivery_delayed`, etc., the handler returns `200 { received: true }` and does nothing else. (We subscribe only to `email.bounced` in the dashboard, but defense in depth.)

### stamps.AC7: Signature verification gates all behavior
- **stamps.AC7.1 Missing signature headers:** Request without `svix-id` / `svix-timestamp` / `svix-signature` headers → `400 { error: 'invalid_signature' }`. No DB read, no refund.
- **stamps.AC7.2 Bad signature:** Request with present-but-wrong signature → `400 { error: 'invalid_signature' }`. No DB read, no refund.
- **stamps.AC7.3 Stale timestamp:** Request with a timestamp older than 5 minutes from now → `400 { error: 'invalid_signature' }` (same handling as Autumn — see `verifySvixTimestamp` in `netlify/lib/billing.ts:717`).
- **stamps.AC7.4 Wrong method:** GET/PUT/DELETE → `405 { error: 'method_not_allowed' }`. No signature check.

### stamps.AC8: Refund audit trail is preserved
- **stamps.AC8.1 Append-only:** The bounce refund inserts a new `stamp_transactions` row with `reason='failed_send_refund'`, `delta=+1`, and `reference_id` equal to the postcard id. The original `reason='send'` row is unchanged. (Same property as Phase 1's sync refund; design line 95.)
- **stamps.AC8.2 Reference traceability:** The new `stamp_transactions.reference_id` matches the original `send` row's `reference_id`, so support can `SELECT * FROM stamp_transactions WHERE reference_id = $postcardId` and see both the debit and the refund.

---

## Codebase findings to encode into this phase

Verified during audit + spot-checks (2026-05-16):

- **Svix verification already exists** as private helpers inside `netlify/lib/billing.ts:706–769` (`getHeader`, `verifySvixTimestamp`, `createSvixSignature`, `hasMatchingSignature`, `timingSafeEqual`). They are the right shape for Resend's webhooks (Resend uses Svix). Extract them to a shared module so this phase doesn't fork.
- **Webhook handler pattern** is established at `netlify/functions/billing/webhook.ts:1–58`. Mirror it: POST-only check, raw-body extraction (handles `event.isBase64Encoded`), `verify*WebhookPayload` call, dispatch.
- **Resend's bounce taxonomy:** Resend's webhook payload puts `bounce.type` under `data.bounce.type`. The exact string values are defined at https://resend.com/docs/dashboard/emails/email-events. Hard-bounce string set must be confirmed during implementation (Task 3 below). At minimum: `hard_bounce`. Treat anything containing `permanent`/`hard` as hard, anything containing `soft`/`transient`/`mailbox_full` as transient, anything else as "log + treat as transient (safer)".
- **The `postcards` table** from Phase 1 already has `resend_email_id` (nullable, indexed via `idx_postcards_resend`). The `id` is a UUID (matches existing migrations).
- **`refundFailedSend(options:{userId, lotId})`** is the existing function in `netlify/lib/stamps.ts:765`. The `userId` corresponds to `postcards.sender_id`. The `lotId` is `postcards.lot_id` (populated by `attachLotAndMarkSent` in Phase 1).
- **Env var convention:** other webhook secrets use `*_WEBHOOK_SECRET` (e.g., `AUTUMN_WEBHOOK_SECRET` referenced via `getAutumnWebhookSecret()` in billing.ts). Use `RESEND_WEBHOOK_SECRET`.
- **No existing Resend webhook handler.** This phase is purely additive — no risk of conflicting with existing function paths.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Extract Svix helpers to a shared module

**Verifies:** None (refactor to enable reuse).

**Files:**
- Create: `/Users/nick/code/drerings/netlify/lib/svix.ts`
- Modify: `/Users/nick/code/drerings/netlify/lib/billing.ts`

**Implementation:**

Move the following helpers from `netlify/lib/billing.ts:706–766` to a new `netlify/lib/svix.ts`:
- `getHeader` (lines 706–715)
- `verifySvixTimestamp` (lines 717–729) — but accept the error message as a parameter so it can say "Invalid Resend webhook timestamp" vs the Autumn variant.
- `createSvixSignature` (lines 731–744)
- `hasMatchingSignature` (lines 746–757)
- `timingSafeEqual` (lines 759–766)

Then export a single composed helper:

```typescript
// netlify/lib/svix.ts
import crypto from 'node:crypto'

export interface SvixHeaders {
    messageId:string
    timestamp:string
    signature:string
}

export function readSvixHeaders (
    headers:Record<string, string|undefined>
):SvixHeaders|null {
    const messageId = getHeader(headers, 'svix-id')
    const timestamp = getHeader(headers, 'svix-timestamp')
    const signature = getHeader(headers, 'svix-signature')

    if (!messageId || !timestamp || !signature) return null

    return { messageId, timestamp, signature }
}

// Returns true iff the signature is current and matches. Caller decides
// the error response. Throws nothing — pure verification.
export function isValidSvixSignature (
    secret:string,
    headers:SvixHeaders,
    rawBody:string,
    nowSeconds:number = Math.floor(Date.now() / 1000),
    toleranceSeconds:number = 5 * 60
):boolean {
    const timestampSeconds = Number(headers.timestamp)
    if (!Number.isFinite(timestampSeconds)) return false
    if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) {
        return false
    }

    const expected = createSvixSignature(
        secret,
        headers.messageId,
        headers.timestamp,
        rawBody
    )
    return hasMatchingSignature(headers.signature, expected)
}

// Internal helpers, copied from billing.ts:
function getHeader (...) { ... }
function createSvixSignature (...) { ... }
function hasMatchingSignature (...) { ... }
function timingSafeEqual (...) { ... }
```

Update `netlify/lib/billing.ts` to import from the new module:

```typescript
import {
    readSvixHeaders,
    isValidSvixSignature
} from './svix.js'
```

Rewrite `verifyAutumnWebhookPayload` (currently lines 264–296) to use the new helpers:

```typescript
export function verifyAutumnWebhookPayload (
    body:string,
    headers:Record<string, string|undefined>
):AutumnWebhookEvent {
    const svix = readSvixHeaders(headers)
    if (!svix) throw new Error('Missing Autumn webhook signature.')

    if (!isValidSvixSignature(getAutumnWebhookSecret(), svix, body)) {
        throw new Error('Invalid Autumn webhook signature.')
    }

    const payload = JSON.parse(body) as unknown
    if (!isRecord(payload)) {
        throw new Error('Invalid Autumn webhook payload.')
    }
    return payload
}
```

Delete the now-orphaned private helpers from billing.ts (lines 706–766). `isRecord` should stay in billing.ts since it's used elsewhere; or move it to a `utils.ts` if there's an obvious home.

**Verification:**

Run: `npm run test:e2e -- billing-webhook`
Expected: all existing `test/us0NN-billing-webhook-*.test.ts` tests still pass. (This is the refactor's regression check — the Autumn webhook behavior must be unchanged.)

Run: `npm run lint && npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

**Commit:** `refactor(stamps): extract svix verification helpers`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add Resend bounce-handling library

**Verifies:** stamps.AC6.1, stamps.AC6.2, stamps.AC6.3, stamps.AC6.4, stamps.AC6.5, stamps.AC8.1, stamps.AC8.2.

**Files:**
- Create: `/Users/nick/code/drerings/netlify/lib/resend-webhook.ts`
- Modify: `/Users/nick/code/drerings/netlify/lib/postcards.ts` (add `getPostcardByResendEmailId` if Phase 1 didn't already; mark refunded helper)
- Create: `/Users/nick/code/drerings/test/us0NN-resend-bounce-handler.test.ts`

**Implementation:**

`netlify/lib/resend-webhook.ts` exports the pure event-handling logic so the function in Task 3 is a thin shell:

```typescript
import { refundFailedSend } from './stamps.js'
import {
    getPostcardByResendEmailId,
    markFailedRefunded
} from './postcards.js'
import { readSvixHeaders, isValidSvixSignature } from './svix.js'

export type ResendBounceClass = 'hard' | 'transient' | 'unknown'

export interface ResendWebhookResult {
    received:true
    refunded:boolean
    reason?:
        | 'transient'
        | 'not_a_postcard'
        | 'already_refunded'
        | 'unhandled_event'
}

// Pure: takes the parsed event, decides what to do.
export async function handleResendEvent (
    event:Record<string, unknown>
):Promise<ResendWebhookResult> {
    const type = typeof event.type === 'string' ? event.type : ''
    if (type !== 'email.bounced') {
        return { received: true, refunded: false,
                 reason: 'unhandled_event' }
    }

    const data = isRecord(event.data) ? event.data : {}
    const emailId = typeof data.email_id === 'string' ?
        data.email_id :
        null
    if (!emailId) {
        return { received: true, refunded: false,
                 reason: 'unhandled_event' }
    }

    const bounceClass = classifyBounce(getRecord(data.bounce))
    if (bounceClass === 'transient') {
        return { received: true, refunded: false, reason: 'transient' }
    }
    if (bounceClass === 'unknown') {
        // Log and treat as transient — safer than over-refunding.
        console.warn('resend bounce: unknown class', {
            email_id: emailId, bounce: data.bounce
        })
        return { received: true, refunded: false, reason: 'transient' }
    }

    const postcard = await getPostcardByResendEmailId(emailId)
    if (!postcard) {
        return { received: true, refunded: false,
                 reason: 'not_a_postcard' }
    }
    if (postcard.status === 'failed_refunded') {
        return { received: true, refunded: false,
                 reason: 'already_refunded' }
    }
    if (postcard.status !== 'sent' || !postcard.lot_id) {
        // Defensive: queued postcards have no lot to refund.
        return { received: true, refunded: false,
                 reason: 'not_a_postcard' }
    }

    await refundFailedSend({
        userId: postcard.sender_id,
        lotId: postcard.lot_id
    })
    await markFailedRefunded(postcard.id)

    return { received: true, refunded: true }
}

// Webhook-secret env var. Helper exported for testability.
export function getResendWebhookSecret ():string {
    const secret = process.env.RESEND_WEBHOOK_SECRET
    if (!secret) {
        throw new Error('RESEND_WEBHOOK_SECRET is required')
    }
    return secret
}

// Returns null on success (caller proceeds to handleResendEvent), or
// a string error code on rejection (caller returns 400).
export function verifyResendSignature (
    rawBody:string,
    headers:Record<string, string|undefined>
):string|null {
    const svix = readSvixHeaders(headers)
    if (!svix) return 'invalid_signature'

    if (!isValidSvixSignature(getResendWebhookSecret(), svix, rawBody)) {
        return 'invalid_signature'
    }
    return null
}

function classifyBounce (
    bounce:Record<string, unknown>|null
):ResendBounceClass {
    if (!bounce) return 'unknown'
    const type = typeof bounce.type === 'string' ?
        bounce.type.toLowerCase() :
        ''
    if (!type) return 'unknown'

    // Known Resend hard-bounce types as of 2026-05.
    // Source: https://resend.com/docs/dashboard/emails/email-events
    // If Resend adds new strings, extend the lists below; defaulting
    // to 'unknown' (treated as transient) keeps us safe.
    const HARD = new Set([
        'hard_bounce',
        'permanent_failure',
        'invalid_email',
        'mailbox_does_not_exist'
    ])
    const TRANSIENT = new Set([
        'soft_bounce',
        'transient_failure',
        'mailbox_full',
        'message_too_large',
        'temporary_failure'
    ])

    if (HARD.has(type)) return 'hard'
    if (TRANSIENT.has(type)) return 'transient'
    return 'unknown'
}

function isRecord (value:unknown):value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getRecord (value:unknown):Record<string, unknown>|null {
    return isRecord(value) ? value : null
}
```

Add `getPostcardByResendEmailId` to `netlify/lib/postcards.ts` if Phase 1's Task 2 didn't add it (the Phase 1 plan declared it; verify the implementation actually exposed it). Signature:

```typescript
export async function getPostcardByResendEmailId (
    resendEmailId:string
):Promise<PostcardRow|null>
```

Implementation: `SELECT * FROM postcards WHERE resend_email_id = $1 LIMIT 1`. Returns the row or null. The `idx_postcards_resend` partial index from Phase 1 makes this fast.

Also ensure `markFailedRefunded(postcardId)` is present and only transitions `'sent' → 'failed_refunded'`:

```sql
UPDATE postcards
SET status = 'failed_refunded', updated_at = now()
WHERE id = $1 AND status = 'sent'
RETURNING id
```

If 0 rows updated, log and continue — the postcard is in an unexpected state but the refund already happened.

**Testing:**

`test/us0NN-resend-bounce-handler.test.ts` exercises `handleResendEvent` directly (pure logic) and exercises `verifyResendSignature` with synthetic headers. Use the `vi.doMock('@netlify/database', ...)` pattern. Key cases:

- **AC6.1 hard bounce path:** mock `getPostcardByResendEmailId` to return `{status:'sent', lot_id:'<uuid-A>', sender_id:'<uuid-B>'}` (use `crypto.randomUUID()` for both — every id column in this project is `uuid`, not a Bluesky DID), mock `refundFailedSend` + `markFailedRefunded`, call `handleResendEvent({type:'email.bounced', data:{email_id:'re_1', bounce:{type:'hard_bounce'}}})`, expect `{received:true, refunded:true}` and both mocks called with correct args.
- **AC6.2 transient bounce:** same setup but `bounce.type='soft_bounce'`, expect `{received:true, refunded:false, reason:'transient'}` and refund/mark NOT called.
- **AC6.3 unknown email_id:** `getPostcardByResendEmailId` returns null, expect `{received:true, refunded:false, reason:'not_a_postcard'}`.
- **AC6.4 already refunded:** postcard's `status='failed_refunded'`, expect `{received:true, refunded:false, reason:'already_refunded'}` and refund NOT called.
- **AC6.5 other event:** `type='email.delivered'`, expect `{received:true, refunded:false, reason:'unhandled_event'}`, NO DB queries.
- **AC8.1 + AC8.2 audit trail:** an integration-style assertion: the mocked `refundFailedSend` is called exactly once with `{userId: '<uuid-B>', lotId: '<uuid-A>'}` (the UUIDs from the mocked postcard fixture above) and `markFailedRefunded` exactly once with the postcard's uuid. The handler must NOT issue an UPDATE on `stamp_transactions` (rely on the trigger from Phase 3 to catch any regression here too).

For `verifyResendSignature`:
- **AC7.1 missing headers:** `verifyResendSignature(body, {})` returns `'invalid_signature'`.
- **AC7.2 bad signature:** stub `RESEND_WEBHOOK_SECRET='whsec_test'`, build a body, compute a signature with a DIFFERENT secret, send it → returns `'invalid_signature'`.
- **AC7.3 stale timestamp:** build a properly-signed payload but with timestamp 1 hour ago → returns `'invalid_signature'`.
- **Happy path:** properly-signed, fresh timestamp → returns `null`.

**Verification:**

Run: `npm run test:e2e -- us0NN-resend-bounce-handler`
Expected: all tests pass.

Run: `npm run lint && npx tsc -p tsconfig.json --noEmit`
Expected: no new errors.

**Commit:** `feat(stamps): resend bounce classifier + signature verification`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Wire the webhook function at `POST /api/webhooks/resend`

**Verifies:** stamps.AC7.1, stamps.AC7.2, stamps.AC7.3, stamps.AC7.4.

**Files:**
- Create: `/Users/nick/code/drerings/netlify/functions/webhooks/resend.ts`
- Create: `/Users/nick/code/drerings/test/us0NN-resend-webhook-handler.test.ts`

**Implementation:**

The function is a thin shell over Task 2's library, mirroring `netlify/functions/billing/webhook.ts`:

```typescript
// netlify/functions/webhooks/resend.ts
import type { Handler } from '@netlify/functions'
import { json } from '../../lib/http.js'
import {
    handleResendEvent,
    verifyResendSignature
} from '../../lib/resend-webhook.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'method_not_allowed' })
    }

    const rawBody = getRawBody(event.body || '', event.isBase64Encoded)
    const sigError = verifyResendSignature(rawBody, event.headers)
    if (sigError) return json(400, { error: sigError })

    let payload:Record<string, unknown>
    try {
        const parsed = JSON.parse(rawBody) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return json(400, { error: 'invalid_payload' })
        }
        payload = parsed as Record<string, unknown>
    } catch {
        return json(400, { error: 'invalid_payload' })
    }

    try {
        const result = await handleResendEvent(payload)
        return json(200, result)
    } catch (err) {
        console.error('resend webhook processing failed', err)
        return json(500, { error: 'webhook_processing_failed' })
    }
}

function getRawBody (body:string, isBase64Encoded:boolean):string {
    if (!isBase64Encoded) return body
    return Buffer.from(body, 'base64').toString('utf8')
}
```

Resolves at `/api/webhooks/resend` automatically via the existing `netlify.toml` `/api/*` redirect.

**Testing:**

`test/us0NN-resend-webhook-handler.test.ts` end-to-end tests of the handler (signature + body parsing + dispatch):

- **AC7.4 wrong method:** GET → 405.
- **AC7.1 missing headers:** POST with no `svix-*` headers → 400 `invalid_signature`.
- **AC7.2/7.3 bad signature:** POST with properly-formatted but wrong signature → 400.
- **Happy path:** POST with a valid signature and a hard-bounce body whose `email_id` matches a mocked postcard → 200 `{received:true, refunded:true}`.
- **Non-JSON body:** POST with body `'not json'` → 400 `invalid_payload`.
- **Internal exception:** mock `handleResendEvent` to throw → 500 `webhook_processing_failed`. (Don't surface the error message to the caller.)

For the signature-valid tests, compute the expected signature inline using Node's `crypto` module the same way `createSvixSignature` does — that gives the test deterministic correctness without depending on the helper itself.

**Verification:**

Run: `npm run test:e2e -- us0NN-resend-webhook-handler`
Expected: all tests pass.

Run: `npm run lint && npx tsc -p tsconfig.json --noEmit`
Expected: no new errors.

**Commit:** `feat(stamps): POST /api/webhooks/resend bounce handler`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Document Resend webhook setup + sanity check

**Verifies:** None (operational documentation + regression sweep).

**Files:**
- Modify: `/Users/nick/code/drerings/README.md` (or a new `docs/resend-webhook.md` if README is opinionated about scope)
- (read-only sweep of the rest)

**Implementation:**

Add a short ops note describing what needs to happen in the Resend dashboard to make this phase live. The audience is the operator (you) at deploy time — keep it tight:

```markdown
### Resend webhook (postcard bounces)

The `/api/webhooks/resend` endpoint expects an Svix-signed payload from
Resend. To enable it:

1. In the Resend dashboard, add a webhook endpoint with URL
   `https://<your-host>/api/webhooks/resend`.
2. Subscribe to the `email.bounced` event only. (Other events are
   silently no-op'd, but subscribing to fewer events reduces noise.)
3. Copy the signing secret (`whsec_…`) and set it as
   `RESEND_WEBHOOK_SECRET` in Netlify env.
4. The "Send a test" button in the Resend dashboard exercises the
   `400 invalid_signature` path with a synthetic payload — it's expected
   to NOT succeed in production until subscribed.
```

If `README.md` is short and project-scoped, drop this near the existing env-variable section. Otherwise create `/Users/nick/code/drerings/docs/resend-webhook.md` and link it from the README.

**Step 1: Sweep regression suite**

Run: `npm run test:e2e`
Expected: all tests pass, including:
- the three new test files from this phase,
- the existing `test/us004-refund-failed-send.test.ts` (refund-failed-send must still work — we didn't change `refundFailedSend`),
- the existing billing webhook tests (the Svix refactor in Task 1 must have been transparent).

Run: `npm test` (esbuild + tapout suite).
Expected: passes.

Run: `npm run lint && npx tsc -p tsconfig.json --noEmit`
Expected: zero errors.

**Step 2: Smoke test the webhook locally**

With `npm start` running, simulate a bounce locally:

```bash
# Compute a fresh Svix signature against your local secret
node -e "
const crypto = require('node:crypto')
const secret = process.env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/,'')
const messageId = 'msg_test'
const timestamp = String(Math.floor(Date.now()/1000))
const body = JSON.stringify({
    type: 'email.bounced',
    data: { email_id: 're_test', bounce: { type: 'hard_bounce' } }
})
const sig = crypto.createHmac('sha256', Buffer.from(secret,'base64'))
    .update(messageId+'.'+timestamp+'.'+body).digest('base64')
console.log('curl -X POST http://localhost:9999/.netlify/functions/webhooks/resend \\\\\n  -H \"svix-id: '+messageId+'\" \\\\\n  -H \"svix-timestamp: '+timestamp+'\" \\\\\n  -H \"svix-signature: v1,'+sig+'\" \\\\\n  -d \\''+body+'\\'')
"
```

Run the printed curl. Expected: `200 {received:true, refunded:false, reason:'not_a_postcard'}` (no postcard with that `email_id` exists locally).

**No commit required** for the sweep itself; the README/doc edit gets its own commit:

```bash
git add README.md  # or docs/resend-webhook.md
git commit -m "docs(stamps): resend webhook setup notes"
```
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

---

## Done when

- `POST /api/webhooks/resend` exists, verifies Svix signatures, and refunds the stamp on hard bounce.
- Transient bounces, non-postcard email_ids, and replays are all 200-no-op.
- `getPostcardByResendEmailId` + `markFailedRefunded` exist in `netlify/lib/postcards.ts`.
- Svix verification is in a shared `netlify/lib/svix.ts` and `netlify/lib/billing.ts` uses it.
- The Resend webhook setup is documented in the README (or a linked doc).
- All new and existing tests pass.

## Out of scope for Phase 2

- **Blob write failure → refund.** Phase 1 handles synchronous failures including blob write throws. Async blob failures aren't a thing (Netlify Blobs is sync from the function's perspective).
- **Resend `email.complained` (spam complaints).** Per design line 161 ("recipient marks it as spam — same, delivery succeeded"), complaints do NOT trigger a refund. We swallow them in the `unhandled_event` branch.
- **DB-layer append-only enforcement.** Phase 3.
- **Scheduled invariant check.** Phase 3.
- **Autumn refund failure recovery.** Phase 4.
