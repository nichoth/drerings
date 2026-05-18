import type { Handler } from '@netlify/functions'
import {
    clearSessionCookie,
    readSessionUserFromCookie
} from '../../lib/session.js'
import { getOAuthClient } from '../../lib/auth/atproto.js'
import { json } from '../../lib/http.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'method_not_allowed' })
    }

    const user = readSessionUserFromCookie(event)

    if (user) {
        // Best-effort revoke at the PDS; do not fail the local logout
        // if this fails.
        try {
            await getOAuthClient().revoke(user.did)
        } catch {
            // ignore
        }
    }

    return {
        statusCode: 200,
        headers: { 'Set-Cookie': clearSessionCookie() },
        body: JSON.stringify({ ok: true })
    }
}
