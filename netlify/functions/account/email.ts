import type { Handler } from '@netlify/functions'
import { getRequestOrigin, json, parseJsonBody } from '../../lib/http.js'
import { getSession } from '../../lib/session.js'
import { requestEmailUpdate } from '../../lib/account.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const session = await getSession(event)

    if (!session) return json(401, { error: 'Please sign in.' })

    const email = normalizeEmail(parseJsonBody(event)?.email)

    if (!email) {
        return json(400, { error: 'Enter a valid email address.' })
    }

    try {
        await requestEmailUpdate(
            session.user.id,
            email,
            getRequestOrigin(event)
        )

        return json(200, { ok: true })
    } catch (err) {
        console.error(err)

        return json(500, {
            error: 'Unable to send the update link right now.'
        })
    }
}

function normalizeEmail (value:unknown):string|null {
    if (typeof value !== 'string') return null

    const email = value.trim().toLowerCase()
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

    return isValid ? email : null
}
