import type { Handler } from '@netlify/functions'
import { getRequestOrigin, json } from '../../../../lib/http.js'
import { generatePasskeyLoginOptions } from '../../../../lib/passkeys.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    try {
        const result = await generatePasskeyLoginOptions(
            getRequestOrigin(event)
        )

        return json(200, {
            options: result.options,
            challenge_token: result.challengeToken
        })
    } catch (err) {
        console.error(err)

        return json(500, {
            error: 'Unable to start passkey sign-in.'
        })
    }
}
