import type { Handler } from '@netlify/functions'
import { json } from '../../../lib/http.js'
import { getSession } from '../../../lib/session.js'
import { issueAutumnStampRefund } from '../../../lib/billing.js'
import {
    refundSentGiftStampLot,
    StampLotNotFoundError,
    StampLotNotRefundableError
} from '../../../lib/stamps.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const lotId = lotIdFromPath(event.path || event.rawUrl)

    if (!lotId) return json(404, { error: 'Gift not found.' })

    const session = await getSession(event)

    if (!session) return json(401, { error: 'Please sign in.' })

    try {
        const result = await refundSentGiftStampLot({
            senderUserId: session.user.id,
            lotId,
            issueRefund: issueAutumnStampRefund
        })

        return json(200, {
            refund_cents: result.refundCents,
            recipient_stamps_balance: result.recipientBalanceAfter
        })
    } catch (error) {
        if (error instanceof StampLotNotFoundError) {
            return json(404, { error: 'Gift not found.' })
        }

        if (error instanceof StampLotNotRefundableError) {
            return json(400, {
                error: 'That gift is no longer refundable.'
            })
        }

        console.error(
            'Sent gift refund failed; check Autumn and recipient state.',
            error
        )

        return json(502, {
            error: 'Unable to refund gift right now.'
        })
    }
}

function lotIdFromPath (path:string):string|null {
    const parts = path.split('/').filter(Boolean)
    const refundIndex = parts.lastIndexOf('refund')
    const lotId = parts[refundIndex + 1]

    return lotId && lotId.trim() ? lotId : null
}
