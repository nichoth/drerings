import type { Handler } from '@netlify/functions'
import { json } from '../../lib/http.js'
import { getSession } from '../../lib/session.js'
import { removePasskey } from '../../lib/account.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'DELETE') {
        return json(405, { error: 'Method not allowed' })
    }

    const session = await getSession(event)

    if (!session) return json(401, { error: 'Please sign in.' })

    const passkeyId = passkeyIdFromPath(event.path || event.rawUrl)

    if (!passkeyId) return json(400, { error: 'Passkey id is required.' })

    const removed = await removePasskey(session.user.id, passkeyId)

    if (!removed) return json(404, { error: 'Passkey not found.' })

    return json(200, { removed: true })
}

function passkeyIdFromPath (path:string):string|null {
    const parts = path.split('/').filter(Boolean)
    const index = parts.lastIndexOf('passkeys')
    const id = parts[index + 1]

    return id ? decodeURIComponent(id) : null
}
