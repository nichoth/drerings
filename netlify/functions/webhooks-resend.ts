import type { Handler } from '@netlify/functions'
import { json } from '../lib/http.js'
import {
    handleResendEvent,
    verifyResendSignature
} from '../lib/resend-webhook.js'

export const handler:Handler = async function handler (event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'method_not_allowed' })
    }

    const rawBody = getRawBody(event.body || '', event.isBase64Encoded)
    const sigError = verifyResendSignature(rawBody, event.headers)
    if (sigError) return json(400, { error: sigError })

    let payload:Record<string, unknown>
    try {
        const parsed = JSON.parse(rawBody) as unknown
        if (!parsed || typeof parsed !== 'object' ||
            Array.isArray(parsed)) {
            return json(400, { error: 'invalid_payload' })
        }
        payload = parsed as Record<string, unknown>
    } catch {
        return json(400, { error: 'invalid_payload' })
    }

    try {
        const result = await handleResendEvent(payload)
        return json(200, { ...result })
    } catch (err) {
        console.error('resend webhook processing failed', err)
        return json(500, { error: 'webhook_processing_failed' })
    }
}

function getRawBody (body:string, isBase64Encoded:boolean):string {
    if (!isBase64Encoded) return body
    return Buffer.from(body, 'base64').toString('utf8')
}
