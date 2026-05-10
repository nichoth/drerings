import type { Handler } from '@netlify/functions'
import { getRequestOrigin, json } from '../../lib/http.js'
import { getSession } from '../../lib/session.js'
import { createCheckoutSession } from '../../lib/billing.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const session = await getSession(event)

    if (!session) return json(401, { error: 'Please sign in.' })

    try {
        const checkout = await createCheckoutSession(
            session.user,
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
