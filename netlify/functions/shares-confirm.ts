import type { Handler } from '@netlify/functions'
import { json, parseJsonBody } from '../lib/http.js'
import { getSession } from '../lib/session.js'
import {
    checkAndIncrement,
    rateLimitResponse
} from '../lib/rate-limit.js'
import {
    isValidIanaTimezone,
    recordShare,
    IdempotencyConflictError
} from '../lib/shares.js'
import * as postStore from '../lib/posts.js'

interface ParsedBody {
    drawing_id:string;
    timezone:string;
    idempotency_key:string;
}

function parseBody (raw:unknown):ParsedBody|null {
    if (!raw || typeof raw !== 'object') return null
    const body = raw as Partial<ParsedBody>

    if (typeof body.drawing_id !== 'string' ||
        body.drawing_id.length === 0) return null
    if (typeof body.timezone !== 'string') return null
    if (typeof body.idempotency_key !== 'string' ||
        body.idempotency_key.length === 0) return null

    return {
        drawing_id: body.drawing_id,
        timezone: body.timezone,
        idempotency_key: body.idempotency_key
    }
}

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const session = await getSession(event)
    if (!session) return json(401, { error: 'Please sign in.' })

    const RATE_MAX = 30
    const RATE_WINDOW = 60
    const limit = await checkAndIncrement(
        `user:${session.user.id}:shares/confirm`,
        RATE_MAX,
        RATE_WINDOW
    )
    if (!limit.allowed) {
        return rateLimitResponse(limit, RATE_MAX, RATE_WINDOW)
    }

    const body = parseBody(parseJsonBody(event))
    if (!body) return json(400, { error: 'Invalid request body.' })

    if (!isValidIanaTimezone(body.timezone)) {
        return json(400, { error: 'Invalid timezone.' })
    }

    const owns = await postStore.userOwnsDrawing(
        session.user.id,
        body.drawing_id
    )
    if (!owns) return json(404, { error: 'Drawing not found.' })

    try {
        const result = await recordShare({
            userId: session.user.id,
            drawingId: body.drawing_id,
            timezone: body.timezone,
            idempotencyKey: body.idempotency_key
        })

        return json(200, result)
    } catch (err) {
        if (err instanceof IdempotencyConflictError) {
            return json(409, {
                error: 'idempotency_conflict',
                message: err.message
            })
        }

        throw err
    }
}
