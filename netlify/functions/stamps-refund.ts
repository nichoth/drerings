import type { Handler } from '@netlify/functions'
import { json } from '../lib/http.js'
import { getSession } from '../lib/session.js'
import { issueAutumnStampRefund } from '../lib/billing.js'
import {
    refundPurchasedStampLot,
    StampLotNotFoundError,
    StampLotNotRefundableError
} from '../lib/stamps.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    const lotId = lotIdFromPath(event.path || event.rawUrl)

    if (!lotId) return json(404, { error: 'Stamp lot not found.' })

    const session = await getSession(event)

    if (!session) return json(401, { error: 'Please sign in.' })

    try {
        const result = await refundPurchasedStampLot({
            userId: session.user.id,
            lotId,
            issueRefund: issueAutumnStampRefund
        })

        return json(200, {
            refund_cents: result.refundCents,
            stamps_balance: result.balanceAfter
        })
    } catch (error) {
        if (error instanceof StampLotNotFoundError) {
            return json(404, { error: 'Stamp lot not found.' })
        }

        if (error instanceof StampLotNotRefundableError) {
            return json(400, {
                error: 'That stamp lot is not refundable.'
            })
        }

        console.error(
            'Stamp refund failed; check Autumn and local stamp state.',
            error
        )

        return json(502, {
            error: 'Unable to refund stamps right now.'
        })
    }
}

function lotIdFromPath (path:string):string|null {
    const parts = path.split('/').filter(Boolean)
    const idx = parts.lastIndexOf('stamps-refund')
    if (idx === -1) return null
    const lotId = parts[idx + 1]

    return lotId && lotId.trim() ? lotId : null
}
