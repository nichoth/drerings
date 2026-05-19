import { getDatabase } from '@netlify/database'
import type { SessionUser } from './auth-store.js'
import {
    sendPendingGiftInviteEmail,
    sendStampGiftEmail
} from './resend.js'
import {
    createPendingGift,
    creditGiftStampLot,
    creditStampLot
} from './stamps.js'
import {
    PACK_DEFINITIONS,
    type StampPackDefinition,
    type StampPackProductId
} from '../../src/stamp-packs.js'
import {
    readSvixHeaders,
    isValidSvixSignature
} from './svix.js'

export {
    PACK_DEFINITIONS,
    type StampPackDefinition,
    type StampPackProductId
}

interface CheckoutSession {
    url:string;
    customer_id:string;
}

interface AutumnCheckoutResponse {
    url?:unknown;
    customer_id?:unknown;
}

interface AutumnWebhookEvent {
    type?:unknown;
    data?:unknown;
    [key:string]:unknown;
}

interface AutumnWebhookResult {
    handled:boolean;
    stamp_purchase?:
        'credited'|
        'already_credited'|
        'gift_credited'|
        'pending_gift_created';
}

export interface AutumnStampRefundOptions {
    checkoutId:string;
    amountCents:number;
}

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

interface StampCheckoutEvent {
    userId:string;
    checkoutId:string;
    pack:StampPackDefinition;
    gift?:StampGiftMetadata;
    pendingGift?:PendingGiftMetadata;
}

export interface GiftRecipient {
    id:string;
    handle:string;
    did:string;
}

export interface PendingGiftRecipient {
    email:string;
    pending:true;
}

interface CheckoutOptions {
    metadata?:Record<string, string>;
}

export async function createCheckoutSession (
    user:SessionUser,
    origin:string,
    productId:StampPackProductId,
    options:CheckoutOptions = {}
):Promise<CheckoutSession> {
    if (shouldUseMockCheckout()) {
        const checkout = {
            url: `${origin}/account?status=ok`,
            customer_id: user.id
        }

        await updateAutumnCustomerId(user.id, checkout.customer_id)

        return checkout
    }

    const syntheticEmail = `${user.handle}@bsky.social`
    const checkoutBody:Record<string, unknown> = {
        customer_id: user.id,
        product_id: getCheckoutProductId(productId),
        success_url: `${origin}/account?status=ok`,
        customer_data: {
            email: syntheticEmail
        }
    }

    if (options.metadata) {
        checkoutBody.metadata = options.metadata
    }

    checkoutBody.checkout_session_params = {
        cancel_url: `${origin}/account?status=cancel`
    }

    const response = await fetch(`${getAutumnApiUrl()}/checkout`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${getAutumnSecretKey()}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify(checkoutBody)
    })

    if (!response.ok) {
        throw new Error('Autumn checkout failed.')
    }

    const body = await response.json() as AutumnCheckoutResponse
    const checkoutUrl = typeof body.url === 'string' ? body.url : ''

    if (!checkoutUrl) {
        throw new Error('Autumn checkout did not return a URL.')
    }

    const customerId = typeof body.customer_id === 'string' ?
        body.customer_id :
        user.id

    await updateAutumnCustomerId(user.id, customerId)

    return {
        url: checkoutUrl,
        customer_id: customerId
    }
}

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

export class InFlightRefundAttemptError extends Error {
    constructor () {
        super('Autumn refund attempt in flight.')
    }
}

export class OrphanedRefundAttemptError extends Error {
    constructor () {
        super('Previous Autumn refund attempt orphaned; operator must '
            + 'resolve.')
    }
}

export class AmbiguousRefundAttemptError extends Error {
    constructor (cause:string) {
        super('Previous Autumn refund attempt outcome ambiguous: ' + cause)
    }
}

export async function issueAutumnStampRefund (
    options:AutumnStampRefundOptions
):Promise<void> {
    // AC15.7: mock mode is a no-op; no attempt row written
    if (shouldUseMockCheckout()) return

    const requestId = `${options.checkoutId}:${options.amountCents}`
    const db = getDatabase()

    // AC15.6: this query goes through db.pool directly — NOT inside
    // any caller transaction. The attempt row survives caller ROLLBACK.
    // AC15.5: lookup-or-insert the attempt row. Behavior depends on
    // the prior status (decision table in the AC).
    const upsert = await db.pool.query<{
        id:string;
        status:string;
        http_status:number|null;
        response_body:string|null;
        attempted_at:string;
        just_inserted:boolean;
    }>(`
        INSERT INTO autumn_refund_attempts
            (checkout_id, amount_cents, request_id, status)
        VALUES ($1, $2, $3, 'attempted')
        ON CONFLICT (request_id) DO UPDATE
            SET status = autumn_refund_attempts.status
        RETURNING id, status, http_status, response_body, attempted_at,
                  (xmax = 0) AS just_inserted
    `, [options.checkoutId, options.amountCents, requestId])
    const attempt = upsert.rows[0]

    // Branch on prior outcome per AC15.5.
    if (attempt.status === 'succeeded') return

    if (
        attempt.status === 'attempted' &&
        attempt.just_inserted !== true
    ) {
        // Row was inserted by a PRIOR call. Decide based on age.
        const ageMs = Date.now() - Date.parse(attempt.attempted_at)
        if (ageMs < 60_000) throw new InFlightRefundAttemptError()
        throw new OrphanedRefundAttemptError()
    }

    if (attempt.status === 'failed') {
        const http = attempt.http_status
        // Safe to retry: Autumn rejected without processing.
        const isSafeToRetry = (
            http !== null && http >= 400 && http < 500
        )
        if (!isSafeToRetry) {
            const cause = http === null ?
                'network error - autumn may have processed' :
                `http ${http} - autumn may have processed`
            throw new AmbiguousRefundAttemptError(cause)
        }
        // Reset the row to 'attempted' so we don't carry forward stale
        // http_status / response_body from the previous failure.
        await db.pool.query(`
            UPDATE autumn_refund_attempts
            SET status = 'attempted',
                attempted_at = now(),
                http_status = NULL,
                response_body = NULL,
                error_message = NULL,
                responded_at = NULL
            WHERE id = $1
        `, [attempt.id])
        // Fall through to the HTTP call below.
    }

    let httpStatus:number|null = null
    let responseBodyTruncated:string|null = null
    let errorMessage:string|null = null

    try {
        const response = await fetch(`${getAutumnApiUrl()}/refunds`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${getAutumnSecretKey()}`,
                'content-type': 'application/json',
                'idempotency-key': requestId
            },
            body: JSON.stringify({
                checkout_id: options.checkoutId,
                amount_cents: options.amountCents
            })
        })

        httpStatus = response.status
        const bodyText = await response.text()
        responseBodyTruncated = bodyText.slice(0, 2000)

        if (!response.ok) {
            await markAttemptFailed(
                attempt.id,
                httpStatus,
                responseBodyTruncated,
                null
            )
            throw new Error('Autumn refund failed.')
        }

        await markAttemptSucceeded(
            attempt.id,
            httpStatus,
            responseBodyTruncated
        )
    } catch (err) {
        // Network error or thrown after marking failed above.
        if (httpStatus === null) {
            errorMessage = err instanceof Error ?
                err.message :
                String(err)
            await markAttemptFailed(attempt.id, null, null, errorMessage)
        }
        throw err
    }
}

async function markAttemptSucceeded (
    attemptId:string,
    httpStatus:number,
    body:string|null
):Promise<void> {
    const db = getDatabase()
    await db.pool.query(`
        UPDATE autumn_refund_attempts
        SET status = 'succeeded',
            http_status = $2,
            response_body = $3,
            responded_at = now()
        WHERE id = $1
    `, [attemptId, httpStatus, body])
}

async function markAttemptFailed (
    attemptId:string,
    httpStatus:number|null,
    body:string|null,
    errorMessage:string|null
):Promise<void> {
    const db = getDatabase()
    await db.pool.query(`
        UPDATE autumn_refund_attempts
        SET status = 'failed',
            http_status = $2,
            response_body = $3,
            error_message = $4,
            responded_at = now()
        WHERE id = $1
    `, [attemptId, httpStatus, body, errorMessage])
}

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

export async function applyAutumnWebhookEvent (
    event:AutumnWebhookEvent
):Promise<AutumnWebhookResult> {
    const stampCheckout = getStampCheckoutEvent(event)

    if (stampCheckout) {
        return applyStampCheckout(stampCheckout)
    }

    return { handled: false }
}

async function applyStampCheckout (
    checkout:StampCheckoutEvent
):Promise<AutumnWebhookResult> {
    if (await hasStampCheckout(checkout.checkoutId)) {
        return {
            handled: true,
            stamp_purchase: 'already_credited'
        }
    }

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

        return {
            handled: true,
            stamp_purchase: 'gift_credited'
        }
    }

    if (checkout.pendingGift) {
        await createPendingGift({
            senderUserId: checkout.pendingGift.senderUserId,
            recipientEmail: checkout.pendingGift.recipientEmail,
            packId: checkout.pack.productId,
            count: checkout.pack.count,
            priceCents: checkout.pack.priceCents,
            autumnCheckoutId: checkout.checkoutId
        })
        await sendPendingGiftInviteEmail({
            email: checkout.pendingGift.recipientEmail,
            senderEmail: checkout.pendingGift.senderEmail,
            count: checkout.pack.count,
            signupUrl: getPendingGiftSignupUrl(checkout.checkoutId)
        })

        return {
            handled: true,
            stamp_purchase: 'pending_gift_created'
        }
    }

    await creditStampLot({
        userId: checkout.userId,
        source: 'purchase',
        count: checkout.pack.count,
        priceCents: checkout.pack.priceCents,
        autumnCheckoutId: checkout.checkoutId
    })

    return {
        handled: true,
        stamp_purchase: 'credited'
    }
}

async function hasStampCheckout (checkoutId:string):Promise<boolean> {
    const db = getDatabase()
    const result = await db.pool.query(`
        SELECT 1
        FROM stamp_transactions
        WHERE reference_id = $1
            AND reason IN ('purchase', 'gift_sent', 'gift_received')
        UNION
        SELECT 1
        FROM pending_gifts
        WHERE autumn_checkout_id = $1
        LIMIT 1
    `, [checkoutId])

    return result.rows.length > 0
}

async function updateAutumnCustomerId (
    userId:string,
    customerId:string
):Promise<void> {
    const db = getDatabase()

    await db.pool.query(`
        UPDATE users
        SET autumn_customer_id = $1
        WHERE id = $2
    `, [customerId, userId])
}

function shouldUseMockCheckout ():boolean {
    if (process.env.NODE_ENV === 'test') return !process.env.AUTUMN_SECRET_KEY
    if (process.env.NETLIFY_LOCAL) return !process.env.AUTUMN_SECRET_KEY

    return false
}

function getStampCheckoutEvent (
    event:AutumnWebhookEvent
):StampCheckoutEvent|null {
    const type = getString(event.type)

    if (type !== 'checkout.completed') return null

    const productId = getWebhookProductId(event)

    if (!productId.startsWith('stamps_')) return null

    const pack = PACK_DEFINITIONS[
        productId as keyof typeof PACK_DEFINITIONS
    ]
    const checkoutId = getWebhookCheckoutId(event)
    const userId = getWebhookCustomerId(event)

    if (!pack || !checkoutId || !userId) return null

    return {
        userId,
        checkoutId,
        pack,
        gift: getWebhookGiftMetadata(event),
        pendingGift: getWebhookPendingGiftMetadata(event)
    }
}

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

    return {
        senderUserId,
        senderHandle,
        recipientEmail
    }
}

function getPendingGiftSignupUrl (checkoutId:string):string {
    const origin = (
        process.env.URL ||
        process.env.DEPLOY_PRIME_URL ||
        'https://drerings.app'
    ).replace(/\/$/, '')
    const params = new URLSearchParams({ gift: checkoutId })

    return `${origin}/login?${params.toString()}`
}

function getWebhookMetadata (
    event:AutumnWebhookEvent
):Record<string, unknown> {
    const data = isRecord(event.data) ? event.data : {}
    const checkout = getRecord(data.checkout)

    return getRecord(event.metadata) ||
        getRecord(data.metadata) ||
        getRecord(checkout?.metadata) ||
        {}
}

function getAutumnSecretKey ():string {
    const key = process.env.AUTUMN_SECRET_KEY

    if (!key) throw new Error('AUTUMN_SECRET_KEY is required')

    return key
}

// Defense-in-depth: runtime guard exists because callers may bypass
// the type system via `as StampPackProductId` assertions on webhook/HTTP
// inputs.
function getCheckoutProductId (
    productId:StampPackProductId
):string {
    if (!PACK_DEFINITIONS[productId]) {
        throw new Error(
            `Unknown stamp pack: ${String(productId)}`
        )
    }

    return productId
}

function getAutumnApiUrl ():string {
    return (process.env.AUTUMN_API_URL || 'https://api.useautumn.com')
        .replace(/\/$/, '')
}

function getAutumnWebhookSecret ():string {
    const secret = process.env.AUTUMN_WEBHOOK_SECRET

    if (!secret) throw new Error('AUTUMN_WEBHOOK_SECRET is required')

    return secret
}

function getWebhookCustomerId (event:AutumnWebhookEvent):string|null {
    const data = isRecord(event.data) ? event.data : {}
    const customer = getRecord(data.customer)

    return (
        getString(event.customer_id) ||
        getString(event.customerId) ||
        getString(data.customer_id) ||
        getString(data.customerId) ||
        getString(customer?.id) ||
        getString(customer?.customer_id) ||
        null
    )
}

function getWebhookCheckoutId (event:AutumnWebhookEvent):string|null {
    const data = isRecord(event.data) ? event.data : {}
    const checkout = getRecord(data.checkout)

    return (
        getString(event.checkout_id) ||
        getString(event.checkoutId) ||
        getString(data.checkout_id) ||
        getString(data.checkoutId) ||
        getString(checkout?.id) ||
        getString(checkout?.checkout_id) ||
        null
    )
}

function getWebhookProductId (event:AutumnWebhookEvent):string {
    const data = isRecord(event.data) ? event.data : {}
    const product = getRecord(data.product)

    return (
        getString(event.product_id) ||
        getString(event.productId) ||
        getString(data.product_id) ||
        getString(data.productId) ||
        getString(product?.id) ||
        getString(product?.product_id)
    )
}

function isRecord (value:unknown):value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getRecord (
    value:unknown
):Record<string, unknown>|null {
    return isRecord(value) ? value : null
}

function getString (value:unknown):string {
    return typeof value === 'string' ? value : ''
}
