import type { Handler } from '@netlify/functions'
import { json } from '../../lib/http.js'
import { getSession } from '../../lib/session.js'
import {
    listPendingGiftsForSender,
    listStampLotsForUser
} from '../../lib/stamps.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'GET') {
        return json(405, { error: 'Method not allowed' })
    }

    const session = await getSession(event)

    if (!session) return json(401, { error: 'Please sign in.' })

    try {
        const [lots, pendingGifts] = await Promise.all([
            listStampLotsForUser(session.user.id),
            listPendingGiftsForSender(session.user.id)
        ])

        return json(200, {
            lots,
            pending_gifts: pendingGifts
        })
    } catch (error) {
        console.error(error)

        return json(500, {
            error: 'Unable to load stamp lots right now.'
        })
    }
}
