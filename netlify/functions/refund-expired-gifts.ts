import { schedule, type Handler } from '@netlify/functions'
import { issueAutumnStampRefund } from '../lib/billing.js'
import { json } from '../lib/http.js'
import { sendPendingGiftRefundEmail } from '../lib/resend.js'
import { refundExpiredPendingGifts } from '../lib/stamps.js'

const runExpiredGiftRefunds:Handler = async function handler () {
    const result = await refundExpiredPendingGifts({
        issueRefund: issueAutumnStampRefund,
        sendRefundEmail: sendPendingGiftRefundEmail
    })

    console.log('Expired pending gift refunds completed.', result)

    return json(200, result)
}

export const handler = schedule('0 9 * * *', runExpiredGiftRefunds)
