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

type SubscriptionStatus = SessionUser['subscription_status']

interface AutumnWebhookEvent {
    type?:unknown;
    data?:unknown;
    [key:string]:unknown;
}

interface AutumnWebhookResult {
    handled:boolean;
    subscription_status?:SubscriptionStatus;
    stamp_purchase?:
        'credited'|
        'already_credited'|
        'gift_credited'|
        'pending_gift_created';
}

export interface CancelSubscriptionResult {
    subscription_status:'canceled';
    subscription_current_period_end:string|null;
}

export interface AutumnStampRefundOptions {
    checkoutId:string;
    amountCents:number;
}

interface StampGiftMetadata {
    senderUserId:string;
    senderEmail:string;
    recipientUserId:string;
    recipientEmail:string;
}

interface PendingGiftMetadata {
    senderUserId:string;
    senderEmail:string;
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
    email:string;
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
    productId?:StampPackProductId,
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

    const checkoutBody:Record<string, unknown> = {
        customer_id: user.id,
        product_id: getCheckoutProductId(productId),
        success_url: `${origin}/account?status=ok`,
        customer_data: {
            email: user.email
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

export async function findGiftRecipient (
    identifier:string
):Promise<GiftRecipient|null> {
    const normalized = identifier.trim().toLowerCase()

    if (!normalized) return null

    const username = normalized.includes('@') ?
        normalized.split('@')[0] :
        normalized
    const db = getDatabase()
    const result = await db.pool.query<GiftRecipient>(`
        SELECT id, email
        FROM users
        WHERE lower(email) = $1
            OR lower(split_part(email, '@', 1)) = $2
        ORDER BY
            CASE WHEN lower(email) = $1 THEN 0 ELSE 1 END,
            created_at ASC
        LIMIT 2
    `, [normalized, username])

    if (result.rows.length !== 1) return null

    return result.rows[0]
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
            gift_sender_email: sender.email,
            gift_recipient_user_id: recipient.id,
            gift_recipient_email: recipient.email
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
            gift_sender_email: sender.email,
            gift_pending_recipient_email: recipientEmail
        }
    })
}

export async function cancelAutumnSubscription (
    user:SessionUser
):Promise<CancelSubscriptionResult|null> {
    if (user.subscription_status !== 'active') return null

    const currentPeriodEnd = await cancelAutumnAtPeriodEnd(user)
    const db = getDatabase()

    await db.pool.query(`
        UPDATE users
        SET
            subscription_status = $1,
            subscription_current_period_end = $2
        WHERE id = $3
    `, ['canceled', currentPeriodEnd, user.id])

    return {
        subscription_status: 'canceled',
        subscription_current_period_end: currentPeriodEnd
    }
}

export async function issueAutumnStampRefund (
    options:AutumnStampRefundOptions
):Promise<void> {
    if (shouldUseMockCheckout()) return

    const response = await fetch(`${getAutumnApiUrl()}/refunds`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${getAutumnSecretKey()}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            checkout_id: options.checkoutId,
            amount_cents: options.amountCents
        })
    })

    if (!response.ok) throw new Error('Autumn refund failed.')
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

    const subscriptionStatus = getWebhookSubscriptionStatus(event)
    const customerId = getWebhookCustomerId(event)

    if (!subscriptionStatus || !customerId) return { handled: false }

    const db = getDatabase()

    await db.pool.query(`
        UPDATE users
        SET
            subscription_status = $1,
            autumn_customer_id = $2
        WHERE autumn_customer_id = $2
            OR id = $3
        RETURNING id
    `, [subscriptionStatus, customerId, customerId])

    return {
        handled: true,
        subscription_status: subscriptionStatus
    }
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
            email: checkout.gift.recipientEmail,
            senderEmail: checkout.gift.senderEmail,
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

async function cancelAutumnAtPeriodEnd (
    user:SessionUser
):Promise<string|null> {
    if (shouldUseMockCheckout()) return nextMonthDate()

    const customerId = user.autumn_customer_id || user.id
    const response = await fetch(
        `${getAutumnApiUrl()}/customers/${customerId}/cancel`,
        {
            method: 'POST',
            headers: {
                authorization: `Bearer ${getAutumnSecretKey()}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify({ cancel_at_period_end: true })
        }
    )

    if (!response.ok) throw new Error('Autumn cancellation failed.')

    const body = await response.json() as Record<string, unknown>

    return getDateString(
        body.current_period_end ||
        body.ends_at ||
        body.period_end ||
        null
    )
}

function nextMonthDate ():string {
    const date = new Date()

    date.setUTCMonth(date.getUTCMonth() + 1)

    return date.toISOString().slice(0, 10)
}

function getDateString (value:unknown):string|null {
    if (typeof value !== 'string' || value.trim() === '') return null

    return value.slice(0, 10)
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
    const senderEmail = getString(metadata.gift_sender_email)
    const recipientUserId = getString(metadata.gift_recipient_user_id)
    const recipientEmail = getString(metadata.gift_recipient_email)

    if (
        !senderUserId ||
        !senderEmail ||
        !recipientUserId ||
        !recipientEmail
    ) {
        return undefined
    }

    return {
        senderUserId,
        senderEmail,
        recipientUserId,
        recipientEmail
    }
}

function getWebhookPendingGiftMetadata (
    event:AutumnWebhookEvent
):PendingGiftMetadata|undefined {
    const metadata = getWebhookMetadata(event)
    const senderUserId = getString(metadata.gift_sender_user_id)
    const senderEmail = getString(metadata.gift_sender_email)
    const recipientEmail = getString(metadata.gift_pending_recipient_email)

    if (!senderUserId || !senderEmail || !recipientEmail) {
        return undefined
    }

    return {
        senderUserId,
        senderEmail,
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

function getAutumnProductId ():string {
    return process.env.AUTUMN_PRODUCT_ID || 'paid'
}

function getCheckoutProductId (
    productId?:StampPackProductId
):string {
    if (productId && PACK_DEFINITIONS[productId]) return productId

    return getAutumnProductId()
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

function getWebhookSubscriptionStatus (
    event:AutumnWebhookEvent
):SubscriptionStatus|null {
    const type = getString(event.type)
    const data = isRecord(event.data) ? event.data : {}
    const scenario = getString(data.scenario)
    const subscription = getRecord(data.subscription)
    const product = getRecord(data.updated_product)
    const values = [
        type,
        scenario,
        getString(data.status),
        getString(data.subscription_status),
        getString(subscription?.status),
        getString(product?.status)
    ].filter(Boolean).map((value) => {
        return value.toLowerCase()
    })

    if (values.some(isCanceledSignal)) return 'canceled'
    if (values.some(isPastDueSignal)) return 'past_due'
    if (values.some(isActiveSignal)) return 'active'

    return null
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

function isActiveSignal (value:string):boolean {
    return value === 'new' ||
        value === 'active' ||
        value === 'subscription.created' ||
        value === 'subscription.activated' ||
        value === 'subscription.renewed' ||
        value === 'customer.subscription.created' ||
        value === 'customer.subscription.activated' ||
        value === 'customer.subscription.renewed' ||
        value === 'renewed'
}

function isCanceledSignal (value:string):boolean {
    return value === 'cancel' ||
        value === 'canceled' ||
        value === 'cancelled' ||
        value === 'subscription.canceled' ||
        value === 'subscription.cancelled' ||
        value === 'customer.subscription.canceled' ||
        value === 'customer.subscription.cancelled'
}

function isPastDueSignal (value:string):boolean {
    return value === 'past_due' ||
        value === 'payment_failed' ||
        value === 'payment.failed' ||
        value === 'subscription.payment_failed' ||
        value === 'customer.subscription.payment_failed'
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
