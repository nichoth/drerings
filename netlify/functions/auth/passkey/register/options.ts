import type { Handler } from '@netlify/functions'
import { getRequestOrigin, json } from '../../../../lib/http.js'
import { generatePasskeyRegistrationOptions } from '../../../../lib/passkeys.js'
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

    try {
        const result = await generatePasskeyRegistrationOptions(
            user,
            getRequestOrigin(event)
        )

        return json(200, {
            options: result.options,
            challenge_token: result.challengeToken
        })
    } catch (err) {
        console.error(err)

        return json(500, {
            error: 'Unable to start passkey registration.'
        })
    }
}
