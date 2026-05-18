import type { Handler } from '@netlify/functions'
import {
    getRequestOrigin,
    json,
    parseJsonBody
} from '../../lib/http.js'
import { getSession } from '../../lib/session.js'
import {
    createCheckoutSession,
    PACK_DEFINITIONS,
    type StampPackProductId
} from '../../lib/billing.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const session = await getSession(event)
    if (!session) {
        return json(401, { error: 'Please sign in.' })
    }

    const body = parseJsonBody(event)
    const productId = normalizeProductId(body?.product_id)

    if (!productId) {
        return json(400, { error: 'Choose a valid stamp pack.' })
    }

    try {
        const checkout = await createCheckoutSession(
            session.user,
            getRequestOrigin(event),
            productId
        )

        return json(200, { url: checkout.url })
    } catch (err) {
        console.error(err)

        return json(500, {
            error: 'Checkout is not configured.'
        })
    }
}

function normalizeProductId (value:unknown):StampPackProductId|null {
    if (typeof value !== 'string') return null

    const productId = value.trim()

    return productId in PACK_DEFINITIONS ?
        productId as StampPackProductId :
        null
}
