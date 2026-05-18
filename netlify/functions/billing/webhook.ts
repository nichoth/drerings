import type { Handler } from '@netlify/functions'
import { json } from '../../lib/http.js'
import {
    applyAutumnWebhookEvent,
    verifyAutumnWebhookPayload
} from '../../lib/billing.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' })
    }

    let payload:ReturnType<typeof verifyAutumnWebhookPayload>

    try {
        payload = verifyAutumnWebhookPayload(
            getRawBody(event.body || '', event.isBase64Encoded),
            event.headers
        )
    } catch {
        return json(400, {
            error: 'Invalid Autumn webhook signature.'
        })
    }

    try {
        const result = await applyAutumnWebhookEvent(payload)

        if (!result.handled) {
            return json(200, { received: true, handled: false })
        }

        return json(200, {
            received: true,
            ...getWebhookResultBody(result)
        })
    } catch (err) {
        console.error(err)

        return json(500, {
            error: 'Autumn webhook processing failed.'
        })
    }
}

function getRawBody (body:string, isBase64Encoded:boolean):string {
    if (!isBase64Encoded) return body

    return Buffer.from(body, 'base64').toString('utf8')
}

function getWebhookResultBody (
    result:Awaited<ReturnType<typeof applyAutumnWebhookEvent>>
):Record<string, unknown> {
    if (result.stamp_purchase) {
        return { stamp_purchase: result.stamp_purchase }
    }

    return {}
}
