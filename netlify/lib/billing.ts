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
