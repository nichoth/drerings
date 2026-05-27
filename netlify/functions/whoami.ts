import type { Handler } from '@netlify/functions'
import { json } from '../lib/http.js'
import { getSession } from '../lib/session.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'GET') {
        return json(405, { error: 'Method not allowed' })
    }

    const session = await getSession(event)

    if (!session) return json(401, { error: 'Please sign in.' })

    return json(200, {
        id: session.user.id,
        did: session.user.did,
        handle: session.user.handle,
        stamps_balance: session.user.stamps_balance ?? 0
    })
}
