import type { Handler } from '@netlify/functions'
import {
    json,
    parseJsonBody
} from '../../lib/http.js'
import { getSession } from '../../lib/session.js'
import {
    checkAndIncrement,
    rateLimitResponse
} from '../../lib/rate-limit.js'
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

    const RATE_MAX = 30
    const RATE_WINDOW = 60
    const limit = await checkAndIncrement(
        `user:${session.user.id}:postcards/send`,
        RATE_MAX,
        RATE_WINDOW
    )
    if (!limit.allowed) {
        return rateLimitResponse(limit, RATE_MAX, RATE_WINDOW)
    }

    const body = parseJsonBody(event)
    const inputResult = parseSendInputWithReason(body)

    if (!inputResult.ok) {
        console.warn(
            'parseSendInput validation failed:',
            inputResult.reason
        )
        return json(400, {
            error: 'Include drawing_id and recipient_email.'
        })
    }

    try {
        const input = inputResult.input
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

            if (postcard.status === 'debiting') {
                // Already claimed by a prior in-flight request. The
                // 'debiting' state has no time-based escape hatch — the
                // only way out is 'sent' or 'failed_refunded' via the
                // holder's completion path.
                return json(409, { error: 'send_in_progress' })
            }

            if (postcard.status === 'queued') {
                const createdAt = new Date(postcard.created_at)
                const tenMinutesAgo = new Date(
                    Date.now() - 10 * 60 * 1000
                )

                if (createdAt >= tenMinutesAgo) {
                    return json(409, {
                        error: 'send_in_progress'
                    })
                }
                // Fall through — proceed to CAS, which will arbitrate.
            }
        }

        // CAS: claim 'queued' -> 'debiting'. Only the winner debits.
        const claim = await postcardStore.transitionPostcardToDebiting(
            postcard.id
        )

        if (!claim.ok) {
            if (claim.status === 'sent') {
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
            if (claim.status === 'failed_refunded') {
                return json(409, { error: 'send_previously_failed' })
            }
            // 'debiting' or null — race lost; ask the client to retry.
            // Note: claim.status can be 'debiting', null, or rarely 'queued'
            // if another caller rolled back the CAS between our UPDATE and
            // our observed SELECT in transitionPostcardToDebiting. The
            // fall-through 409 send_in_progress is benign in all three
            // cases — the next user retry succeeds.
            return json(409, { error: 'send_in_progress' })
        }

        let debit:{lotId:string; balanceAfter:number}
        try {
            debit = await debitStamp({
                userId: session.user.id,
                referenceId: postcard.id
            })
        } catch (err) {
            if (err instanceof InsufficientStampsError) {
                // We held the 'debiting' claim but ran out of stamps.
                // Roll the state back to queued so a subsequent attempt
                // (after the user tops up) can proceed via the same
                // idempotency_key.
                // If this rollback fails, the row sticks at 'debiting'
                // until the operator sweep — see Operator notes. We do
                // NOT wrap CAS+debit+rollback in a single transaction
                // because debitStamp already manages its own transaction;
                // double-wrapping would require restructuring debitStamp.
                try {
                    await postcardStore.rollbackDebitingToQueued(
                        postcard.id
                    )
                } catch (rollbackErr) {
                    console.error('rollbackDebitingToQueued failed', {
                        postcardId: postcard.id,
                        originalError: err,
                        rollbackError: rollbackErr
                    })
                    // Still return 402 — the user's underlying problem is
                    // insufficient stamps. The stuck 'debiting' row is an
                    // operator concern (see README operator runbook).
                }
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
                senderHandle: session.user.handle,
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
            // If the DB UPDATE for markFailedRefunded fails after
            // refundFailedSend succeeds, the postcards row stays
            // in 'queued' until the 10-minute resurrection window
            // expires; the next retry adopts the row and runs a
            // fresh debit. Bounded inconsistency, healed by the
            // resurrection logic in findOrCreateQueuedPostcard.
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

type ParseResult =
    | { ok:true; input:SendInput }
    | { ok:false; reason:string }

function parseSendInputWithReason (
    body:Record<string, unknown>|null
):ParseResult {
    if (!body) {
        return { ok: false, reason: 'body parse failed' }
    }

    const drawingId = body.drawing_id
    const recipientEmail = body.recipient_email

    if (typeof drawingId !== 'string' || !drawingId.trim()) {
        return {
            ok: false,
            reason: 'drawing_id missing or invalid'
        }
    }

    if (typeof recipientEmail !== 'string' ||
        !isValidEmail(recipientEmail.trim())) {
        return {
            ok: false,
            reason: 'recipient_email missing or invalid'
        }
    }

    const idempotencyKey = body.idempotency_key

    if (idempotencyKey !== undefined &&
        typeof idempotencyKey !== 'string') {
        return {
            ok: false,
            reason: 'idempotency_key invalid type'
        }
    }

    return {
        ok: true,
        input: {
            drawing_id: drawingId.trim(),
            recipient_email: recipientEmail.trim(),
            idempotency_key: typeof idempotencyKey === 'string' ?
                idempotencyKey :
                null
        }
    }
}

function isValidEmail (email:string):boolean {
    if (!email || email.length < 3 || email.length > 254) {
        return false
    }

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}
