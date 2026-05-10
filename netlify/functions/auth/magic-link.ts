import type { Handler } from '@netlify/functions'
import { createMagicLinkLogin } from '../../lib/auth-store.js'
import { getRequestOrigin, json, parseJsonBody } from '../../lib/http.js'
import { sendMagicLinkEmail } from '../../lib/resend.js'

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
        const login = await createMagicLinkLogin(email)

        if (login) {
            const loginUrl = new URL(
                '/api/auth/magic-link/callback',
                getRequestOrigin(event)
            )

            loginUrl.searchParams.set('token', login.token)

            await sendMagicLinkEmail({
                email,
                loginUrl: loginUrl.toString()
            })
        }

        return json(200, { ok: true })
    } catch (err) {
        console.error(err)
        return json(500, {
            error: 'Unable to send a magic link right now.'
        })
    }
}

function normalizeEmail (value:unknown):string|null {
    if (typeof value !== 'string') return null

    const email = value.trim().toLowerCase()
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

    return isValid ? email : null
}
