import type { Handler } from '@netlify/functions'
import { getRequestOrigin, json, parseJsonBody } from '../../lib/http.js'
import { upsertCheckoutUser } from '../../lib/auth-store.js'
import {
    createCheckoutSession,
    PACK_DEFINITIONS,
    type StampPackProductId
} from '../../lib/billing.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const body = parseJsonBody(event)
    const email = normalizeEmail(body?.email)
    const productId = normalizeProductId(body?.product_id)

    if (!email) {
        return json(400, { error: 'Enter a valid email address.' })
    }

    if (body?.product_id && !productId) {
        return json(400, { error: 'Choose a valid stamp pack.' })
    }

    try {
        const user = await upsertCheckoutUser(email)
        const checkout = await createCheckoutSession(
            user,
            getRequestOrigin(event),
            productId || undefined
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

function normalizeEmail (value:unknown):string|null {
    if (typeof value !== 'string') return null

    const email = value.trim().toLowerCase()
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

    return isValid ? email : null
}
