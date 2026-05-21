import type { Handler } from '@netlify/functions'
import { json } from '../lib/http.js'
import { getSession } from '../lib/session.js'
import { listStampTransactionsForUser } from '../lib/stamps.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'GET') {
        return json(405, { error: 'Method not allowed' })
    }

    const session = await getSession(event)

    if (!session) return json(401, { error: 'Please sign in.' })

    try {
        const before = parseBefore(event.queryStringParameters?.before)
        const page = await listStampTransactionsForUser(
            session.user.id,
            before
        )

        return json(200, {
            transactions: page.transactions,
            next_before: page.next_before
        })
    } catch (error) {
        console.error(error)

        return json(500, {
            error: 'Unable to load stamp history right now.'
        })
    }
}

function parseBefore (value:string|undefined|null):string|null {
    if (!value) return null

    const date = new Date(value)

    if (Number.isNaN(date.getTime())) return null

    return date.toISOString()
}
