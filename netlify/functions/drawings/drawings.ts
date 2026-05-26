import type { Handler } from '@netlify/functions'
import { json, parseJsonBody } from '../../lib/http.js'
import * as drawingStore from '../../lib/drawings.js'
import { getSession } from '../../lib/session.js'
import type { SavedDrawingInput } from '../../lib/drawings.js'

export const handler:Handler = async function handler (event) {
    if (!['DELETE', 'GET', 'POST', 'PUT'].includes(event.httpMethod)) {
        return json(405, { error: 'Method not allowed' })
    }

    const session = await getSession(event)

    if (!session) return json(401, { error: 'Please sign in.' })

    if (event.httpMethod === 'GET') {
        const drawingId = drawingIdFromPath(event.path || event.rawUrl)

        try {
            if (drawingId) {
                const drawing = await drawingStore.getSavedDrawing(
                    session.user.id,
                    drawingId
                )

                if (!drawing) {
                    return json(404, { error: 'Drawing not found.' })
                }

                return json(200, {
                    id: drawing.id,
                    image: drawing.image,
                    text: drawing.text,
                    alt_text: drawing.alt_text,
                    updated_at: drawing.updated_at
                })
            }

            const drawings = await drawingStore.listSavedDrawings(
                session.user.id
            )

            return json(200, { drawings })
        } catch (err) {
            console.error(err)

            return json(500, {
                error: 'Unable to load drawings right now.'
            })
        }
    }

    if (event.httpMethod === 'DELETE') {
        const drawingId = drawingIdFromPath(event.path || event.rawUrl)

        if (!drawingId) {
            return json(400, { error: 'Drawing id is required.' })
        }

        try {
            const deleted = await drawingStore.deleteSavedDrawing(
                session.user.id,
                drawingId
            )

            if (!deleted) {
                return json(403, {
                    error: 'You cannot delete this drawing.'
                })
            }

            return json(200, { deleted: true })
        } catch (err) {
            console.error(err)

            return json(500, {
                error: 'Unable to delete the drawing right now.'
            })
        }
    }

    const input = parseDrawingInput(parseJsonBody(event))

    if (!input) {
        return json(400, {
            error: 'Include image, text, and alt_text.'
        })
    }

    try {
        if (event.httpMethod === 'POST') {
            const drawing = await drawingStore.createSavedDrawing(
                session.user.id,
                input
            )

            return json(200, {
                id: drawing.id,
                created_at: drawing.created_at
            })
        }

        const drawingId = drawingIdFromPath(event.path || event.rawUrl)

        if (!drawingId) {
            return json(400, { error: 'Drawing id is required.' })
        }

        const drawing = await drawingStore.updateSavedDrawing(
            session.user.id,
            drawingId,
            input
        )

        if (!drawing) return json(404, { error: 'Drawing not found.' })

        return json(200, {
            id: drawing.id,
            updated_at: drawing.updated_at
        })
    } catch (err) {
        console.error(err)

        return json(500, {
            error: 'Unable to save the drawing right now.'
        })
    }
}

function parseDrawingInput (
    body:Record<string, unknown>|null
):SavedDrawingInput|null {
    if (!body) return null

    if (
        typeof body.image !== 'string' ||
        typeof body.text !== 'string' ||
        typeof body.alt_text !== 'string' ||
        body.image.trim() === ''
    ) {
        return null
    }

    return {
        image: body.image,
        text: body.text,
        alt_text: body.alt_text
    }
}

function drawingIdFromPath (path:string):string|null {
    const parts = path.split('/').filter(Boolean)
    const drawingIndex = parts.lastIndexOf('drawings')
    const id = parts[drawingIndex + 1]

    return id ? decodeURIComponent(id) : null
}
