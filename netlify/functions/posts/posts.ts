import type { Handler } from '@netlify/functions'
import { json, parseJsonBody } from '../../lib/http.js'
import { getSession } from '../../lib/session.js'
import * as postStore from '../../lib/posts.js'

export const handler:Handler = async function handler (event) {
    if (!['GET', 'POST'].includes(event.httpMethod)) {
        return json(405, { error: 'Method not allowed' })
    }

    if (event.httpMethod === 'GET') {
        const postId = postIdFromPath(event.path || event.rawUrl)

        if (!postId) return json(404, { error: 'Post not found.' })

        try {
            const post = await postStore.getPublishedPost(postId)

            if (!post) return json(404, { error: 'Post not found.' })

            return json(200, {
                id: post.id,
                drawing_id: post.drawing_id,
                image: post.image,
                text: post.text,
                alt_text: post.alt_text,
                published_at: post.published_at
            })
        } catch (err) {
            console.error(err)

            return json(500, {
                error: 'Unable to load the post right now.'
            })
        }
    }

    const session = await getSession(event)

    if (!session) return json(401, { error: 'Please sign in.' })

    const input = parsePublishInput(parseJsonBody(event))

    if (!input) {
        return json(400, { error: 'Include drawing_id.' })
    }

    try {
        const ownsDrawing = await postStore.userOwnsDrawing(
            session.user.id,
            input.drawing_id
        )

        if (!ownsDrawing) {
            return json(403, {
                error: 'You cannot publish this drawing.'
            })
        }

        const post = await postStore.publishDrawing(
            session.user.id,
            input.drawing_id
        )

        if (!post) {
            throw new Error(
                `Drawing disappeared while publishing ${input.drawing_id}`
            )
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

function postIdFromPath (path:string):number|null {
    const parts = path.split('/').filter(Boolean)
    const postIndex = parts.lastIndexOf('posts')
    const id = Number(parts[postIndex + 1])

    return Number.isInteger(id) && id > 0 ? id : null
}
