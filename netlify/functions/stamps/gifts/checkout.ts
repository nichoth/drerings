import type { Handler } from '@netlify/functions'
import { getRequestOrigin, json, parseJsonBody } from '../../../lib/http.js'
import { getSession } from '../../../lib/session.js'
import {
    checkAndIncrement,
    rateLimitResponse
} from '../../../lib/rate-limit.js'
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

    const RATE_MAX = 5
    const RATE_WINDOW = 60
    const limit = await checkAndIncrement(
        `user:${session.user.id}:stamps/gifts/checkout`,
        RATE_MAX,
        RATE_WINDOW
    )
    if (!limit.allowed) {
        return rateLimitResponse(limit, RATE_MAX, RATE_WINDOW)
    }

    const body = parseJsonBody(event)
    const productId = normalizeProductId(body?.product_id)
    const recipientHandle = normalizeRecipient(body?.recipient)

    if (!productId) {
        return json(400, { error: 'Choose a valid stamp pack.' })
    }

    if (!recipientHandle) {
        return json(400, { error: 'Enter a recipient email or username.' })
    }

    try {
        const recipient = await lookupGiftRecipient(recipientHandle)

        if (recipient?.id === session.user.id) {
            return json(404, { error: 'Recipient account was not found.' })
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

        if (!isEmail(recipientHandle)) {
            return json(404, { error: 'Recipient account was not found.' })
        }

        const checkout = await createPendingGiftCheckoutSession(
            session.user,
            getRequestOrigin(event),
            productId,
            recipientHandle
        )

        return json(200, {
            url: checkout.url,
            recipient: {
                email: recipientHandle,
                pending: true
            }
        })
    } catch (err) {
        console.error(err)

        return json(500, {
            error: 'Unable to start gift checkout right now.'
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

function normalizeRecipient (value:unknown):string|null {
    if (typeof value !== 'string') return null

    const trimmed = value.trim()

    if (!trimmed) return null

    // DIDs are case-sensitive identifiers passed through verbatim.
    // Handles are normalized to lowercase by lookupGiftRecipient.
    const isDid = trimmed.toLowerCase().startsWith('did:')

    return isDid ? trimmed : trimmed.toLowerCase()
}

function isEmail (value:string):boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
