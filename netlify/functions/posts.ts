import type { Handler } from '@netlify/functions'
import { json, parseJsonBody } from '../lib/http.js'
import { getSession } from '../lib/session.js'
import * as postStore from '../lib/posts.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const session = await getSession(event)

    if (!session) return json(401, { error: 'Please sign in.' })

    if (session.user.subscription_status !== 'active') {
        return json(402, {
            error: 'Upgrade to publish drawings.'
        })
    }

    const input = parsePublishInput(parseJsonBody(event))

    if (!input) {
        return json(400, { error: 'Include drawing_id.' })
    }

    try {
        const post = await postStore.publishDrawing(
            session.user.id,
            input.drawing_id
        )

        if (!post) {
            return json(403, {
                error: 'You cannot publish this drawing.'
            })
        }

        return json(200, { id: post.id })
    } catch (err) {
        console.error(err)

        return json(500, {
            error: 'Unable to publish the drawing right now.'
        })
    }
}

function parsePublishInput (
    body:Record<string, unknown>|null
):{ drawing_id:string }|null {
    if (!body || typeof body.drawing_id !== 'string') return null
    if (body.drawing_id.trim() === '') return null

    return { drawing_id: body.drawing_id }
}
