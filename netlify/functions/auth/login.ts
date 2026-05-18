import type { Handler } from '@netlify/functions'
import { getOAuthClient } from '../../lib/auth/atproto.js'
import { json } from '../../lib/http.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'GET') {
        return json(405, { error: 'method_not_allowed' })
    }

    const handle = event.queryStringParameters?.handle?.trim()

    if (!handle) {
        return json(400, { error: 'handle_required' })
    }

    const client = getOAuthClient()
    const authorizeUrl = await client.authorize(handle, {
        scope: 'atproto transition:generic'
    })

    return {
        statusCode: 302,
        headers: { Location: authorizeUrl.toString() },
        body: ''
    }
}
