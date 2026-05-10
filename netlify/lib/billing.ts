import crypto from 'node:crypto'
import { getDatabase } from '@netlify/database'
import type { SessionUser } from './auth-store.js'

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
}

export interface CancelSubscriptionResult {
    subscription_status:'canceled';
    subscription_current_period_end:string|null;
}

export async function createCheckoutSession (
    user:SessionUser,
    origin:string
):Promise<CheckoutSession> {
    if (shouldUseMockCheckout()) {
        const checkout = {
            url: `${origin}/account?status=ok`,
            customer_id: user.id
        }

        await updateAutumnCustomerId(user.id, checkout.customer_id)

        return checkout
    }

    const response = await fetch(`${getAutumnApiUrl()}/checkout`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${getAutumnSecretKey()}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            customer_id: user.id,
            product_id: getAutumnProductId(),
            success_url: `${origin}/account?status=ok`,
            customer_data: {
                email: user.email
            },
            checkout_session_params: {
                cancel_url: `${origin}/account?status=cancel`
            }
        })
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

export function verifyAutumnWebhookPayload (
    body:string,
    headers:Record<string, string|undefined>
):AutumnWebhookEvent {
    const messageId = getHeader(headers, 'svix-id')
    const timestamp = getHeader(headers, 'svix-timestamp')
    const signature = getHeader(headers, 'svix-signature')

    if (!messageId || !timestamp || !signature) {
        throw new Error('Missing Autumn webhook signature.')
    }

    verifySvixTimestamp(timestamp)

    const expectedSignature = createSvixSignature(
        getAutumnWebhookSecret(),
        messageId,
        timestamp,
        body
    )

    if (!hasMatchingSignature(signature, expectedSignature)) {
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

function getAutumnSecretKey ():string {
    const key = process.env.AUTUMN_SECRET_KEY

    if (!key) throw new Error('AUTUMN_SECRET_KEY is required')

    return key
}

function getAutumnProductId ():string {
    return process.env.AUTUMN_PRODUCT_ID || 'paid'
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

function getHeader (
    headers:Record<string, string|undefined>,
    name:string
):string|null {
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === name) return value || null
    }

    return null
}

function verifySvixTimestamp (timestamp:string):void {
    const timestampSeconds = Number(timestamp)
    const toleranceSeconds = 5 * 60
    const nowSeconds = Math.floor(Date.now() / 1000)

    if (!Number.isFinite(timestampSeconds)) {
        throw new Error('Invalid Autumn webhook timestamp.')
    }

    if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) {
        throw new Error('Expired Autumn webhook signature.')
    }
}

function createSvixSignature (
    secret:string,
    messageId:string,
    timestamp:string,
    body:string
):string {
    const secretValue = secret.replace(/^whsec_/, '')
    const secretKey = Buffer.from(secretValue, 'base64')

    return crypto
        .createHmac('sha256', secretKey)
        .update(`${messageId}.${timestamp}.${body}`)
        .digest('base64')
}

function hasMatchingSignature (
    signatureHeader:string,
    expectedSignature:string
):boolean {
    return signatureHeader.split(' ').some((signature) => {
        const [version, value] = signature.split(',')

        if (version !== 'v1' || !value) return false

        return timingSafeEqual(value, expectedSignature)
    })
}

function timingSafeEqual (left:string, right:string):boolean {
    const leftBuffer = Buffer.from(left, 'base64')
    const rightBuffer = Buffer.from(right, 'base64')

    if (leftBuffer.length !== rightBuffer.length) return false

    return crypto.timingSafeEqual(leftBuffer, rightBuffer)
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
