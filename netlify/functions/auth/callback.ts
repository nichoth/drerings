import type { Handler } from '@netlify/functions'
import { getOAuthClient } from '../../lib/auth/atproto.js'
import { upsertOAuthUser } from '../../lib/auth-store.js'
import { createSessionCookie } from '../../lib/session.js'
import { json } from '../../lib/http.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'GET') {
        return json(405, { error: 'method_not_allowed' })
    }

    const queryString = new URLSearchParams(
        event.queryStringParameters as Record<string, string>
    )

    if (!queryString.get('state') || !queryString.get('code')) {
        return json(400, { error: 'invalid_callback' })
    }

    const client = getOAuthClient()

    let oauthSession
    try {
        const result = await client.callback(queryString)
        oauthSession = result.session
    } catch (err) {
        return json(400, {
            error: 'oauth_callback_failed',
            message: err instanceof Error ? err.message : 'unknown'
        })
    }

    // sub is the user's DID (permanent identifier).
    const did = oauthSession.sub

    // Read the current handle from the authed agent. The library
    // attaches a DPoP-bound Agent to the OAuthSession; the
    // com.atproto.server.getSession call returns the handle the
    // PDS currently associates with the DID.
    let handle = did
    try {
        const accountInfo = await oauthSession.agent
            .com.atproto.server.getSession()
        handle = accountInfo.data.handle ?? did
    } catch {
        // Handle the rare case where the agent call fails after a
        // successful token exchange. Fall back to DID-as-handle;
        // upsertOAuthUser still upserts by DID, and the next
        // login refreshes handle_updated_at.
    }

    // upsertOAuthUser performs INSERT ... ON CONFLICT (did) DO
    // UPDATE SET handle = EXCLUDED.handle, handle_updated_at = now()
    // — so a returning user with a renamed handle gets the new
    // value here. This is the path AC1.2 exercises.
    const { user } = await upsertOAuthUser(did, handle)

    return {
        statusCode: 302,
        headers: {
            Location: '/',
            'Set-Cookie': createSessionCookie(user)
        },
        body: ''
    }
}
