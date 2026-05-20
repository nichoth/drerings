# Phase 1: Gift recipient resolution (P0-1) Implementation Plan

**Goal:** Replace the broken `findGiftRecipient(users.email)` lookup with a handle/DID resolver; un-skip the three `us017` test files.

**Architecture:** Add `lookupGiftRecipient(identifier)` in `netlify/lib/billing.ts` that queries `users.handle` (lowercase exact match) or `users.did` (when the identifier starts with `did:`). Change the exported `GiftRecipient` interface from `{id, email}` to `{id, handle, did}`. Autumn checkout metadata carries `gift_recipient_handle` instead of `gift_recipient_email`. The Resend gift email is synthesized as `${handle}@bsky.social` (best-effort delivery; recipients also see the credit in-app via `stamps_balance`).

**Tech Stack:** TypeScript 5.8 (ESM), Preact 10, `@netlify/database` (Postgres), `@netlify/functions`, `vitest`, atproto OAuth (handles/DIDs already in `users` table).

**Scope:** Phase 1 of 7.

**Codebase verified:** 2026-05-18.
- `netlify/lib/billing.ts:160-185` — `findGiftRecipient` still queries `users.email` (verified). Migration 0010 dropped `email`. Latest migration is `0014`.
- `users` table (post-0010): `id, created_at, autumn_customer_id, did, handle, handle_updated_at, stamps_balance`. No `email`.
- No existing `WHERE handle = $1` / `WHERE did = $1` helpers anywhere — first one lives here.
- Three skipped tests confirmed: `test/us017-gift-checkout-api.test.ts`, `test/us017-gift-stamp-webhook.test.ts`, `test/us017-gift-stamps-ui.test.ts` (all `describe.skip`).
- `netlify/functions/stamps/gifts/checkout.ts:36` calls `findGiftRecipient` and falls back to `createPendingGiftCheckoutSession` for email-like strings.
- Webhook reader: `getWebhookGiftMetadata` (`netlify/lib/billing.ts:554-578`) requires `gift_sender_email` + `gift_recipient_email` to be present. Webhook contract changes with the metadata.
- **In-flight Autumn sessions:** No pre-existing gift checkout sessions carry old metadata. Gift checkout has been broken (500) since migration 0010 dropped `users.email`. All new sessions created during Phase 1 will use the new handle-based metadata, and the webhook reader is defensive against malformed metadata.
- `src/components/gift-stamps.ts:17-87` — Component is input-only (collects recipient string and pack selection). Does not display recipient object from checkout response. No `recipient.email` or `recipient.handle` references.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### payment-hardening.AC1: Gift recipient lookup by handle or DID

- **payment-hardening.AC1.1 Success — handle:** `lookupGiftRecipient('alice.bsky.social')` returns `{id, handle: 'alice.bsky.social', did: 'did:plc:abc123'}` when a user with that handle exists.
- **payment-hardening.AC1.2 Success — DID:** `lookupGiftRecipient('did:plc:abc123')` returns the matching user row.
- **payment-hardening.AC1.3 Success — case-insensitive handle:** `'Alice.BSKY.Social'` resolves the same row as `'alice.bsky.social'`.
- **payment-hardening.AC1.4 Failure — not found:** returns `null` for an unknown handle or DID.
- **payment-hardening.AC1.5 Failure — empty input:** returns `null` for empty or whitespace-only input.

### payment-hardening.AC2: Gift checkout endpoint routes correctly

- **payment-hardening.AC2.1 Success — known recipient:** `POST /api/stamps/gifts/checkout` with `{ recipient: 'alice.bsky.social', product_id: '10_stamps' }` returns `200` with `{ url, recipient: { id, handle, did } }` and routes through `createGiftCheckoutSession`.
- **payment-hardening.AC2.2 Success — pending recipient:** `POST /api/stamps/gifts/checkout` with `{ recipient: 'someone@example.com', product_id: '10_stamps' }` returns `200` and routes through `createPendingGiftCheckoutSession`.
- **payment-hardening.AC2.3 Failure — unknown handle:** `POST /api/stamps/gifts/checkout` with `{ recipient: 'unknown.bsky.social', product_id: '10_stamps' }` returns `404 "Recipient account was not found."` — **never 500**.
- **payment-hardening.AC2.4 Failure — self-gift:** Returns `404 "Recipient account was not found."` when the resolved recipient is the sender (preserves existing behavior at `checkout.ts:38`).

### payment-hardening.AC3: Autumn metadata uses handle-based fields

- **payment-hardening.AC3.1 Success — known recipient:** Autumn checkout body for a known recipient contains metadata fields `gift_sender_user_id`, `gift_sender_handle`, `gift_recipient_user_id`, `gift_recipient_handle`. **Does NOT contain `gift_recipient_email`.**
- **payment-hardening.AC3.2 Success — pending recipient:** Autumn checkout body for a pending recipient contains `gift_sender_user_id`, `gift_sender_handle`, `gift_pending_recipient_email`.

### payment-hardening.AC4: Webhook reads the new metadata shape

- **payment-hardening.AC4.1 Success:** A `checkout.completed` event carrying `gift_recipient_user_id` + `gift_recipient_handle` + `gift_sender_user_id` + `gift_sender_handle` credits the recipient via `creditGiftStampLot` and records the sender's `gift_sent` transaction.
- **payment-hardening.AC4.2 Defensive:** A webhook missing the gift metadata fields (neither gift nor pending gift metadata extracts successfully) is treated as a direct (non-gift) stamp purchase: returns `{ handled: true, stamp_purchase: 'credited' }` and credits the buyer. Never throws a 5xx.

### payment-hardening.AC5: Three us017 tests are un-skipped and passing

- **payment-hardening.AC5.1 Success:** `test/us017-gift-checkout-api.test.ts` — `describe.skip` removed, all tests pass.
- **payment-hardening.AC5.2 Success:** `test/us017-gift-stamp-webhook.test.ts` — `describe.skip` removed, all tests pass.
- **payment-hardening.AC5.3 Success:** `test/us017-gift-stamps-ui.test.ts` — `describe.skip` removed, all tests pass.

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Replace `findGiftRecipient` with `lookupGiftRecipient`

**Verifies:** payment-hardening.AC1.1, AC1.2, AC1.3, AC1.4, AC1.5

**Files:**
- Modify: `netlify/lib/billing.ts:79-82` — replace `GiftRecipient` interface
- Modify: `netlify/lib/billing.ts:160-185` — replace function body and exported name
- Create: `test/us017-lookup-gift-recipient.test.ts` (unit, vitest)

**Implementation:**

Update the exported type:

```ts
export interface GiftRecipient {
    id:string;
    handle:string;
    did:string;
}
```

Replace `findGiftRecipient` with `lookupGiftRecipient` (rename + new query):

```ts
export async function lookupGiftRecipient (
    identifier:string
):Promise<GiftRecipient|null> {
    const trimmed = identifier.trim()

    if (!trimmed) return null

    const isDid = trimmed.toLowerCase().startsWith('did:')
    const db = getDatabase()
    const result = await db.pool.query<GiftRecipient>(
        isDid ?
            `SELECT id, handle, did
             FROM users
             WHERE did = $1
             LIMIT 1` :
            `SELECT id, handle, did
             FROM users
             WHERE lower(handle) = $1
             LIMIT 1`,
        [isDid ? trimmed : trimmed.toLowerCase()]
    )

    return result.rows[0] ?? null
}
```

Notes:
- Handles are normalized to lowercase before lookup; DIDs are case-sensitive identifiers passed through verbatim.
- No `OR` between the two queries — picking by prefix is unambiguous and uses index-friendly equality predicates.
- A future migration may add `CREATE INDEX users_handle_lower_idx ON users (lower(handle))` if scale warrants. Not blocking for this phase.

**Testing:**

`test/us017-lookup-gift-recipient.test.ts` covers each AC case. Mock `getDatabase().pool.query` per the existing pattern in `test/us020-shares-record.test.ts`:

- AC1.1: Mock the handle SQL path; query with `'alice.bsky.social'` → expect query called with `WHERE lower(handle) = $1`, params `['alice.bsky.social']`. Mock returns `{rows: [{id, handle, did}]}`. Assert result.
- AC1.2: Mock the DID SQL path; query with `'did:plc:abc123'` → expect `WHERE did = $1`, params `['did:plc:abc123']`. Assert result.
- AC1.3: Query with `'Alice.BSKY.Social'` → expect param `'alice.bsky.social'`. Assert result.
- AC1.4: Mock returns `{rows: []}`; query with `'unknown.bsky.social'` → expect `null`.
- AC1.5: Query with `''` and `'   '` (no DB call) → expect `null` both times. Assert mock was NOT called.

**Verification:**
```sh
npx vitest run test/us017-lookup-gift-recipient.test.ts
```
Expected: 5 passing tests.

```sh
npm run lint
```
Expected: no errors.

**Commit:** `feat(billing): resolve gift recipients by handle/DID instead of dropped email column`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update Autumn checkout metadata and webhook reader

**Verifies:** payment-hardening.AC3.1, AC3.2, AC4.1, AC4.2

**Files:**
- Modify: `netlify/lib/billing.ts:58-69` — replace `StampGiftMetadata` and `PendingGiftMetadata` interfaces
- Modify: `netlify/lib/billing.ts:187-218` — update `createGiftCheckoutSession` and `createPendingGiftCheckoutSession` metadata payloads
- Modify: `netlify/lib/billing.ts:423-487` — update `applyStampCheckout` to use `handle` for the Resend "to" address
- Modify: `netlify/lib/billing.ts:554-597` — update `getWebhookGiftMetadata` and `getWebhookPendingGiftMetadata` to read the new field names

**Implementation:**

Internal type renames in `billing.ts`:

```ts
interface StampGiftMetadata {
    senderUserId:string;
    senderHandle:string;
    recipientUserId:string;
    recipientHandle:string;
}

interface PendingGiftMetadata {
    senderUserId:string;
    senderHandle:string;
    recipientEmail:string;
}
```

`createGiftCheckoutSession` body (replaces `:187-202`):

```ts
export async function createGiftCheckoutSession (
    sender:SessionUser,
    origin:string,
    productId:StampPackProductId,
    recipient:GiftRecipient
):Promise<CheckoutSession> {
    return createCheckoutSession(sender, origin, productId, {
        metadata: {
            gift_sender_user_id: sender.id,
            gift_sender_handle: sender.handle,
            gift_recipient_user_id: recipient.id,
            gift_recipient_handle: recipient.handle
        }
    })
}
```

`createPendingGiftCheckoutSession` body (replaces `:204-218`):

```ts
export async function createPendingGiftCheckoutSession (
    sender:SessionUser,
    origin:string,
    productId:StampPackProductId,
    recipientEmail:string
):Promise<CheckoutSession> {
    return createCheckoutSession(sender, origin, productId, {
        metadata: {
            gift_sender_user_id: sender.id,
            gift_sender_handle: sender.handle,
            gift_pending_recipient_email: recipientEmail
        }
    })
}
```

Update `applyStampCheckout` (`:432-451`). When sending the recipient email, synthesize from handle:

```ts
if (checkout.gift) {
    await creditGiftStampLot({
        senderUserId: checkout.gift.senderUserId,
        recipientUserId: checkout.gift.recipientUserId,
        count: checkout.pack.count,
        priceCents: checkout.pack.priceCents,
        autumnCheckoutId: checkout.checkoutId
    })
    await sendStampGiftEmail({
        email: `${checkout.gift.recipientHandle}@bsky.social`,
        senderEmail: `${checkout.gift.senderHandle}@bsky.social`,
        count: checkout.pack.count
    })

    return { handled: true, stamp_purchase: 'gift_credited' }
}
```

Webhook reader (`:554-597`) — read the new fields:

```ts
function getWebhookGiftMetadata (
    event:AutumnWebhookEvent
):StampGiftMetadata|undefined {
    const metadata = getWebhookMetadata(event)
    const senderUserId = getString(metadata.gift_sender_user_id)
    const senderHandle = getString(metadata.gift_sender_handle)
    const recipientUserId = getString(metadata.gift_recipient_user_id)
    const recipientHandle = getString(metadata.gift_recipient_handle)

    if (
        !senderUserId ||
        !senderHandle ||
        !recipientUserId ||
        !recipientHandle
    ) {
        return undefined
    }

    return {
        senderUserId,
        senderHandle,
        recipientUserId,
        recipientHandle
    }
}

function getWebhookPendingGiftMetadata (
    event:AutumnWebhookEvent
):PendingGiftMetadata|undefined {
    const metadata = getWebhookMetadata(event)
    const senderUserId = getString(metadata.gift_sender_user_id)
    const senderHandle = getString(metadata.gift_sender_handle)
    const recipientEmail = getString(metadata.gift_pending_recipient_email)

    if (!senderUserId || !senderHandle || !recipientEmail) {
        return undefined
    }

    return { senderUserId, senderHandle, recipientEmail }
}
```

**Testing:**

Inline unit tests (extend `test/us017-gift-checkout-api.test.ts` and `test/us017-gift-stamp-webhook.test.ts` — see Tasks 3 and 4). At this task we just need the code to compile and the type signatures to be self-consistent.

**Verification:**
```sh
npx tsc --noEmit
```
Expected: no type errors.

```sh
npm run lint
```
Expected: no errors.

**Commit:** `refactor(billing): swap gift metadata from email to handle on checkout and webhook`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->
### Task 3: Update gift checkout handler

**Verifies:** payment-hardening.AC2.1, AC2.2, AC2.3, AC2.4

**Files:**
- Modify: `netlify/functions/stamps/gifts/checkout.ts:1-104` — rename import, use new resolver and updated response shape

**Implementation:**

Replace the imports and handler:

```ts
import type { Handler } from '@netlify/functions'
import { getRequestOrigin, json, parseJsonBody } from '../../../lib/http.js'
import { getSession } from '../../../lib/session.js'
import {
    createGiftCheckoutSession,
    createPendingGiftCheckoutSession,
    lookupGiftRecipient,
    PACK_DEFINITIONS,
    type StampPackProductId
} from '../../../lib/billing.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const session = await getSession(event)
    if (!session) {
        return json(401, { error: 'Sign in before gifting stamps.' })
    }

    const body = parseJsonBody(event)
    const productId = normalizeProductId(body?.product_id)
    const recipientInput = normalizeRecipient(body?.recipient)

    if (!productId) {
        return json(400, { error: 'Choose a valid stamp pack.' })
    }

    if (!recipientInput) {
        return json(400, {
            error: 'Enter a recipient handle, DID, or email.'
        })
    }

    try {
        const recipient = await lookupGiftRecipient(recipientInput)

        if (recipient?.id === session.user.id) {
            return json(404, {
                error: 'Recipient account was not found.'
            })
        }

        if (recipient) {
            const checkout = await createGiftCheckoutSession(
                session.user,
                getRequestOrigin(event),
                productId,
                recipient
            )

            return json(200, {
                url: checkout.url,
                recipient
            })
        }

        if (!isEmail(recipientInput)) {
            return json(404, {
                error: 'Recipient account was not found.'
            })
        }

        const checkout = await createPendingGiftCheckoutSession(
            session.user,
            getRequestOrigin(event),
            productId,
            recipientInput
        )

        return json(200, {
            url: checkout.url,
            recipient: { email: recipientInput, pending: true }
        })
    } catch (err) {
        console.error(err)

        return json(500, {
            error: 'Unable to start gift checkout right now.'
        })
    }
}
```

`normalizeProductId`, `normalizeRecipient`, and `isEmail` helpers stay as in the existing file (lines 83-103).

**Testing:** Coverage moves into `test/us017-gift-checkout-api.test.ts` in Task 4.

**Verification:**
```sh
npx tsc --noEmit && npm run lint
```

**Commit:** `feat(gifts): wire gift checkout endpoint to handle/DID resolver`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Un-skip `test/us017-gift-checkout-api.test.ts`

**Verifies:** payment-hardening.AC2.1, AC2.2, AC2.3, AC2.4, AC3.1, AC3.2, AC5.1

**Files:**
- Modify: `test/us017-gift-checkout-api.test.ts` — remove `describe.skip` → `describe`, update mocks to handle-based fixtures, update assertions

**Implementation:**

1. Remove the leading TODO comment block (lines 9-12).
2. Change `describe.skip(...)` → `describe(...)`.
3. Where the test mocks the `findGiftRecipient` SQL response (search for `email`, `users.email`, or `findGiftRecipient` in the file), update to:
   - Match the new SQL: either `WHERE lower(handle) = $1` or `WHERE did = $1`.
   - Mock rows: `{ id: 'recipient-uuid', handle: 'alice.bsky.social', did: 'did:plc:abc' }` (no `email`).
4. Update assertions on the Autumn checkout body's `metadata` field to expect `gift_recipient_user_id` and `gift_recipient_handle` (NOT `gift_recipient_email`).
5. Add coverage for AC2.3 (unknown handle → 404) and AC2.2 (email fallback → 200 with `pending: true`) if not already present.

**Testing:** This task IS the tests. All cases must use the new resolver and metadata shape.

**Verification:**
```sh
npx vitest run test/us017-gift-checkout-api.test.ts
```
Expected: all tests pass, none skipped.

**Commit:** `test(gift): un-skip us017 gift checkout API tests against handle resolver`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Un-skip `test/us017-gift-stamp-webhook.test.ts`

**Verifies:** payment-hardening.AC4.1, AC4.2, AC5.2

**Files:**
- Modify: `test/us017-gift-stamp-webhook.test.ts` — remove `describe.skip`, update webhook fixture metadata, update assertions

**Implementation:**

1. Remove the leading TODO comment block (lines 3-6).
2. Change `describe.skip(...)` → `describe(...)`.
3. Update the webhook event fixture's `data.metadata` to use:
   - `gift_sender_user_id`, `gift_sender_handle`, `gift_recipient_user_id`, `gift_recipient_handle` for the gift path.
   - `gift_sender_user_id`, `gift_sender_handle`, `gift_pending_recipient_email` for the pending path.
4. Update the assertion on `sendStampGiftEmail` mock to expect `email: 'alice.bsky.social@bsky.social'` (synthesized).
5. Add an AC4.2 case: webhook event with EMPTY metadata → `applyStampCheckout` returns `{ handled: true, stamp_purchase: 'credited' }` (treats as self-purchase) — must not throw.

**Testing:** This task IS the tests.

**Verification:**
```sh
npx vitest run test/us017-gift-stamp-webhook.test.ts
```
Expected: all tests pass, none skipped.

**Commit:** `test(gift): un-skip us017 gift webhook tests against handle metadata`
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Un-skip `test/us017-gift-stamps-ui.test.ts`

**Verifies:** payment-hardening.AC5.3

**Files:**
- Modify: `test/us017-gift-stamps-ui.test.ts` — remove `describe.skip`, update fixtures, update assertions
- Note: `src/components/gift-stamps.ts` — component analysis below

**Implementation:**

1. Remove the leading TODO comment block (lines 13-16).
2. Change `describe.skip(...)` → `describe(...)`.
3. Update the mock at `test/us017-gift-stamps-ui.test.ts:35-44` (the `'/api/stamps/gifts/checkout'` response):
   - Old: `recipient: { id: 'recipient-1', email: 'friend@example.com' }`
   - New: `recipient: { id: 'recipient-1', handle: 'alice.bsky.social', did: 'did:plc:abc' }` (for known recipients)
4. Update the request body assertion at `test/us017-gift-stamps-ui.test.ts:81-84` to send `recipient: 'alice.bsky.social'` (handle, not email).

**Component shape verified:**

`src/components/gift-stamps.ts` does NOT read or display the checkout response's recipient object. The component is purely an input form (lines 20-87): it collects a recipient string (email or handle) and a pack selection, then calls `State.StartGiftStampCheckout`. It does not conditionally render recipient name, email, or handle anywhere. Therefore: **No `recipient.email` or `recipient.handle` references exist in the component. UI test updates only.**

**Testing:** This task IS the tests.

**Verification:**
```sh
npx vitest run test/us017-gift-stamps-ui.test.ts
```
Expected: all tests pass, none skipped.

**Commit:** `test(gift): un-skip us017 gift UI tests with handle-based recipient fixture`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Full suite verification

**Verifies:** payment-hardening.AC5.1, AC5.2, AC5.3 (regression)

**Files:** No code changes — verification task.

**Implementation:** None. Run the full test suite and lint.

**Verification:**
```sh
npm run lint && npx vitest run
```
Expected: lint passes; all vitest tests pass with zero `.skip` in the `us017-*` files.

```sh
grep -n "describe.skip\|it.skip\|test.skip" test/us017-*.test.ts
```
Expected: no matches.

**Commit:** none (verification only).
<!-- END_TASK_7 -->

---

## Phase 1 Done When

- `findGiftRecipient` is replaced by `lookupGiftRecipient` (queries `users.handle` or `users.did`).
- `GiftRecipient` interface is `{id, handle, did}`.
- Autumn checkout metadata uses `*_handle` fields, never `gift_recipient_email`.
- The Autumn webhook reads the new fields and credits correctly.
- All three `test/us017-*.test.ts` files are un-skipped and pass.
- `npm run lint && npx vitest run` is green.
