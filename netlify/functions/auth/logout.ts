import type { Handler } from '@netlify/functions'
import { json } from '../../lib/http.js'
import { clearSessionCookie } from '../../lib/session.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    return {
        ...json(200, { logged_out: true }),
        headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': clearSessionCookie()
        }
    }
}
