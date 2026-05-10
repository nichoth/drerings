import type { Handler } from '@netlify/functions'
import { json } from '../../lib/http.js'
import { cancelAutumnSubscription } from '../../lib/billing.js'
import { getSession } from '../../lib/session.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const session = await getSession(event)

    if (!session) return json(401, { error: 'Please sign in.' })

    try {
        const result = await cancelAutumnSubscription(session.user)

        return json(200, {
            ...(result || {
                subscription_status: 'canceled',
                subscription_current_period_end: null
            })
        })
    } catch (err) {
        console.error(err)

        return json(500, {
            error: 'Unable to cancel subscription right now.'
        })
    }
}
