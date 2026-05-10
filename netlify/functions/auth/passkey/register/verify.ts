import type { Handler } from '@netlify/functions'
import {
    getRequestOrigin,
    json,
    parseJsonBody
} from '../../../../lib/http.js'
import { verifyPasskeyRegistration } from '../../../../lib/passkeys.js'
import { readSessionUserFromCookie } from '../../../../lib/session.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const user = readSessionUserFromCookie(event)

    if (!user) {
        return json(401, {
            error: 'Sign in before registering a passkey.'
        })
    }

    const body = parseJsonBody(event)
    const challengeToken = body?.challenge_token
    const response = body?.response

    if (typeof challengeToken !== 'string' || !response) {
        return json(400, { error: 'Passkey registration is incomplete.' })
    }

    try {
        const verified = await verifyPasskeyRegistration({
            user,
            origin: getRequestOrigin(event),
            challengeToken,
            response: response as never
        })

        if (!verified) {
            return json(400, { error: 'Passkey registration failed.' })
        }

        return json(200, { verified: true })
    } catch (err) {
        console.error(err)

        return json(400, { error: 'Passkey registration failed.' })
    }
}
