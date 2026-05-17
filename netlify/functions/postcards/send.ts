import type { Handler } from '@netlify/functions'
import {
    json,
    parseJsonBody
} from '../../lib/http.js'
import { getSession } from '../../lib/session.js'
import {
    debitStamp,
    refundFailedSend,
    InsufficientStampsError
} from '../../lib/stamps.js'
import { getDrawingImage } from '../../lib/drawing-images.js'
import { sendPostcardEmail } from '../../lib/resend.js'
import * as postStore from '../../lib/posts.js'
import * as postcardStore from '../../lib/postcards.js'
import { getDatabase } from '@netlify/database'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const session = await getSession(event)

    if (!session) {
        return json(401, { error: 'Please sign in.' })
    }

    const body = parseJsonBody(event)
    const input = parseSendInput(body)

    if (!input) {
        console.warn(
            'parseSendInput failed',
            {
                drawing_id: body?.drawing_id,
                recipient_email: body?.recipient_email
            }
        )
        return json(400, {
            error: 'Include drawing_id and recipient_email.'
        })
    }

    try {
        const ownsDrawing = await postStore.userOwnsDrawing(
            session.user.id,
            input.drawing_id
        )

        if (!ownsDrawing) {
            return json(403, {
                error: 'You cannot send this drawing.'
            })
        }

        const drawingRow = await getDrawingData(
            input.drawing_id,
            session.user.id
        )

        if (!drawingRow) {
            return json(404, {
                error: 'Drawing not found.'
            })
        }

        const { postcard, reused } =
            await postcardStore.findOrCreateQueuedPostcard({
                senderId: session.user.id,
                drawingId: input.drawing_id,
                recipientEmail: input.recipient_email,
                lotId: null,
                idempotencyKey: input.idempotency_key
            })

        if (reused) {
            if (postcard.status === 'sent') {
                try {
                    const balance = await getCurrentStampBalance(
                        session.user.id
                    )
                    return json(200, {
                        id: postcard.id,
                        balance_after: balance
                    })
                } catch (_err) {
                    return json(404, {
                        error: 'User not found.'
                    })
                }
            }

            if (postcard.status === 'failed_refunded') {
                return json(409, {
                    error: 'send_previously_failed'
                })
            }

            if (postcard.status === 'queued') {
                const createdAt = new Date(postcard.created_at)
                const tenMinutesAgo = new Date(
                    Date.now() - 10 * 60 * 1000
                )

                if (createdAt < tenMinutesAgo) {
                    // Stale row - proceed with fresh attempt
                } else {
                    return json(409, {
                        error: 'send_in_progress'
                    })
                }
            }
        }

        let debit:{lotId:string; balanceAfter:number}
        try {
            debit = await debitStamp({
                userId: session.user.id,
                referenceId: postcard.id
            })
        } catch (err) {
            if (err instanceof InsufficientStampsError) {
                await postcardStore.deleteIfQueued(postcard.id)
                return json(402, { error: 'insufficient_stamps' })
            }

            throw err
        }

        try {
            const png = await getDrawingImage(drawingRow.blob_key)

            if (!png) {
                throw new Error('drawing image missing')
            }

            const resendId = await sendPostcardEmail({
                to: input.recipient_email,
                senderHandle: session.user.email,
                text: drawingRow.text,
                pngBase64: Buffer.from(png).toString('base64'),
                postcardId: postcard.id
            })

            await postcardStore.attachLotAndMarkSent(
                postcard.id,
                debit.lotId,
                resendId
            )

            return json(200, {
                id: postcard.id,
                balance_after: debit.balanceAfter
            })
        } catch (sendError) {
            // If markFailedRefunded fails after refundFailedSend
            // succeeds, the postcards row stays in 'queued' until
            // the 10-minute resurrection window expires. The
            // next retry will adopt it and proceed with a fresh
            // debit attempt, bounded inconsistency healed by
            // resurrection logic.
            await refundFailedSend({
                userId: session.user.id,
                lotId: debit.lotId
            })

            await postcardStore.markFailedRefunded(postcard.id)

            console.error('postcard send failed', sendError)

            return json(502, { error: 'send_failed' })
        }
    } catch (err) {
        console.error(err)

        return json(500, {
            error: 'Unable to send the postcard right now.'
        })
    }
}

type DrawingData = {
    blob_key:string;
    text:string;
    alt_text:string;
}

async function getDrawingData (
    drawingId:string,
    userId:string
):Promise<DrawingData|null> {
    const db = getDatabase()
    const result = await db.pool.query<DrawingData>(`
        SELECT blob_key, text, alt_text
        FROM drawings
        WHERE id = $1 AND user_id = $2
    `, [drawingId, userId])

    return result.rows[0] || null
}

async function getCurrentStampBalance (
    userId:string
):Promise<number> {
    const db = getDatabase()
    const result = await db.pool.query<
        {stamps_balance:number}
    >(`
        SELECT stamps_balance
        FROM users
        WHERE id = $1
    `, [userId])

    if (!result.rows[0]) {
        throw new Error(
            'user not found (replayed on nonexistent account?)'
        )
    }

    return result.rows[0].stamps_balance
}

type SendInput = {
    drawing_id:string;
    recipient_email:string;
    idempotency_key:string|null;
}

function parseSendInput (
    body:Record<string, unknown>|null
):SendInput|null {
    if (!body) return null

    const drawingId = body.drawing_id
    const recipientEmail = body.recipient_email

    if (typeof drawingId !== 'string' || !drawingId.trim()) {
        return null
    }

    if (typeof recipientEmail !== 'string' ||
        !isValidEmail(recipientEmail.trim())) {
        return null
    }

    const idempotencyKey = body.idempotency_key

    if (idempotencyKey !== undefined &&
        typeof idempotencyKey !== 'string') {
        return null
    }

    return {
        drawing_id: drawingId.trim(),
        recipient_email: recipientEmail.trim(),
        idempotency_key: typeof idempotencyKey === 'string' ?
            idempotencyKey :
            null
    }
}

function isValidEmail (email:string):boolean {
    if (!email || email.length < 3 || email.length > 254) {
        return false
    }

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}
