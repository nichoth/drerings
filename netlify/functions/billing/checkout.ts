import type { Handler } from '@netlify/functions'
import { getRequestOrigin, json, parseJsonBody } from '../../lib/http.js'
import { upsertCheckoutUser } from '../../lib/auth-store.js'
import { createCheckoutSession } from '../../lib/billing.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const body = parseJsonBody(event)
    const email = normalizeEmail(body?.email)

    if (!email) {
        return json(400, { error: 'Enter a valid email address.' })
    }

    try {
        const user = await upsertCheckoutUser(email)
        const checkout = await createCheckoutSession(
            user,
            getRequestOrigin(event)
        )

        return json(200, { url: checkout.url })
    } catch (err) {
        console.error(err)

        return json(500, {
            error: 'Checkout is not configured.'
        })
    }
}

function normalizeEmail (value:unknown):string|null {
    if (typeof value !== 'string') return null

    const email = value.trim().toLowerCase()
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

    return isValid ? email : null
}
