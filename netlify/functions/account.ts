import type { Handler } from '@netlify/functions'
import { json } from '../lib/http.js'
import { clearSessionCookie, getSession } from '../lib/session.js'
import {
    deleteAccountData,
    getAccountDetails
} from '../lib/account.js'

export const handler:Handler = async function handler (event) {
    if (!['DELETE', 'GET'].includes(event.httpMethod)) {
        return json(405, { error: 'Method not allowed' })
    }

    const session = await getSession(event)

    if (!session) return json(401, { error: 'Please sign in.' })

    if (event.httpMethod === 'GET') {
        const account = await getAccountDetails(session.user.id)

        if (!account) return json(404, { error: 'Account not found.' })

        return json(200, { ...account })
    }

    try {
        await deleteAccountData(session.user.id)

        return {
            ...json(200, { deleted: true }),
            headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': clearSessionCookie()
            }
        }
    } catch (err) {
        console.error(err)

        return json(500, {
            error: 'Unable to delete account right now.'
        })
    }
}
