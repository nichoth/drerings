// pattern: Functional Core

import {
    getPostcardByResendEmailId,
    refundPostcardBounce
} from './postcards.js'
import { readSvixHeaders, isValidSvixSignature } from './svix.js'

export type ResendBounceClass = 'hard'|'transient'|'unknown'

export type ResendWebhookResult = {
    received:true;
    refunded:boolean;
    reason?:
        | 'transient'
        | 'not_a_postcard'
        | 'already_refunded'
        | 'unhandled_event';
}

// Pure: takes the parsed event, decides what to do.
export async function handleResendEvent (
    event:Record<string, unknown>
):Promise<ResendWebhookResult> {
    const type = typeof event.type === 'string' ? event.type : ''
    if (type !== 'email.bounced') {
        return {
            received: true,
            refunded: false,
            reason: 'unhandled_event'
        }
    }

    const data = isRecord(event.data) ? event.data : {}
    const emailId = typeof data.email_id === 'string' ?
        data.email_id :
        null
    if (!emailId) {
        return {
            received: true,
            refunded: false,
            reason: 'unhandled_event'
        }
    }

    const bounceClass = classifyBounce(getRecord(data.bounce))
    if (bounceClass === 'transient') {
        return {
            received: true,
            refunded: false,
            reason: 'transient'
        }
    }
    if (bounceClass === 'unknown') {
        // Log and treat as transient — safer than over-refunding.
        console.warn('resend bounce: unknown class', {
            email_id: emailId,
            bounce: data.bounce
        })
        return {
            received: true,
            refunded: false,
            reason: 'transient'
        }
    }

    const postcard = await getPostcardByResendEmailId(emailId)
    if (!postcard) {
        return {
            received: true,
            refunded: false,
            reason: 'not_a_postcard'
        }
    }
    if (postcard.status === 'failed_refunded') {
        return {
            received: true,
            refunded: false,
            reason: 'already_refunded'
        }
    }
    if (postcard.status !== 'sent' || !postcard.lot_id) {
        // Defensive: queued postcards have no lot to refund.
        return {
            received: true,
            refunded: false,
            reason: 'not_a_postcard'
        }
    }

    const result = await refundPostcardBounce(postcard.id)

    if (result.refunded) {
        return { received: true, refunded: true }
    }

    if (result.reason === 'already_refunded') {
        return {
            received: true,
            refunded: false,
            reason: 'already_refunded'
        }
    }

    // 'not_sent' — postcard was 'queued' or missing. Treat as not-a-postcard
    // for the webhook response since there's nothing to refund.
    return {
        received: true,
        refunded: false,
        reason: 'not_a_postcard'
    }
}

// Webhook-secret env var. Helper exported for testability.
export function getResendWebhookSecret ():string {
    const secret = process.env.RESEND_WEBHOOK_SECRET
    if (!secret) {
        throw new Error('RESEND_WEBHOOK_SECRET is required')
    }
    return secret
}

// Returns null on success (caller proceeds to handleResendEvent), or
// a string error code on rejection (caller returns 400).
export function verifyResendSignature (
    rawBody:string,
    headers:Record<string, string|undefined>
):string|null {
    const svix = readSvixHeaders(headers)
    if (!svix) return 'invalid_signature'

    if (!isValidSvixSignature(
        getResendWebhookSecret(),
        svix,
        rawBody
    )) {
        return 'invalid_signature'
    }
    return null
}

function classifyBounce (
    bounce:Record<string, unknown>|null
):ResendBounceClass {
    if (!bounce) return 'unknown'
    const type = typeof bounce.type === 'string' ?
        bounce.type.toLowerCase() :
        ''
    if (!type) return 'unknown'

    // Known Resend hard-bounce types as of 2026-05.
    // Source: https://resend.com/docs/dashboard/emails/email-events
    // If Resend adds new strings, extend the lists below; defaulting
    // to 'unknown' (treated as transient) keeps us safe.
    const HARD = new Set([
        'hard_bounce',
        'permanent_failure',
        'invalid_email',
        'mailbox_does_not_exist'
    ])
    const TRANSIENT = new Set([
        'soft_bounce',
        'transient_failure',
        'mailbox_full',
        'message_too_large',
        'temporary_failure'
    ])

    if (HARD.has(type)) return 'hard'
    if (TRANSIENT.has(type)) return 'transient'
    return 'unknown'
}

function isRecord (value:unknown):value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getRecord (value:unknown):Record<string, unknown>|null {
    return isRecord(value) ? value : null
}
