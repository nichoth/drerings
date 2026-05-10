import type { Handler } from '@netlify/functions'
import {
    getRequestOrigin,
    json,
    parseJsonBody
} from '../../../../lib/http.js'
import { verifyPasskeyLogin } from '../../../../lib/passkeys.js'
import { createSessionCookie } from '../../../../lib/session.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const body = parseJsonBody(event)
    const challengeToken = body?.challenge_token
    const response = body?.response

    if (typeof challengeToken !== 'string' || !response) {
        return json(400, { error: 'Passkey sign-in is incomplete.' })
    }

    try {
        const user = await verifyPasskeyLogin({
            origin: getRequestOrigin(event),
            challengeToken,
            response: response as never
        })

        if (!user) return json(400, { error: 'Passkey sign-in failed.' })

        return {
            ...json(200, { verified: true }),
            headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': createSessionCookie(user)
            }
        }
    } catch (err) {
        console.error(err)

        return json(400, { error: 'Passkey sign-in failed.' })
    }
}
