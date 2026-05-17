// pattern: Functional Core
import crypto from 'node:crypto'

export interface SvixHeaders {
    messageId:string;
    timestamp:string;
    signature:string;
}

export function readSvixHeaders (
    headers:Record<string, string|undefined>
):SvixHeaders|null {
    const messageId = getHeader(headers, 'svix-id')
    const timestamp = getHeader(headers, 'svix-timestamp')
    const signature = getHeader(headers, 'svix-signature')

    if (!messageId || !timestamp || !signature) return null

    return { messageId, timestamp, signature }
}

// Returns true iff the signature is current and matches. Caller decides
// the error response. Throws nothing — pure verification.
export function isValidSvixSignature (
    secret:string,
    headers:SvixHeaders,
    rawBody:string,
    nowSeconds:number = Math.floor(Date.now() / 1000),
    toleranceSeconds:number = 5 * 60
):boolean {
    const timestampSeconds = Number(headers.timestamp)
    if (!Number.isFinite(timestampSeconds)) return false
    if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) {
        return false
    }

    const expected = createSvixSignature(
        secret,
        headers.messageId,
        headers.timestamp,
        rawBody
    )
    return hasMatchingSignature(headers.signature, expected)
}

// Internal helpers:

function getHeader (
    headers:Record<string, string|undefined>,
    name:string
):string|null {
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === name) return value || null
    }

    return null
}

function createSvixSignature (
    secret:string,
    messageId:string,
    timestamp:string,
    body:string
):string {
    const secretValue = secret.replace(/^whsec_/, '')
    const secretKey = Buffer.from(secretValue, 'base64')

    return crypto
        .createHmac('sha256', secretKey)
        .update(`${messageId}.${timestamp}.${body}`)
        .digest('base64')
}

function hasMatchingSignature (
    signatureHeader:string,
    expectedSignature:string
):boolean {
    return signatureHeader.split(' ').some((signature) => {
        const [version, value] = signature.split(',')

        if (version !== 'v1' || !value) return false

        return timingSafeEqual(value, expectedSignature)
    })
}

function timingSafeEqual (left:string, right:string):boolean {
    const leftBuffer = Buffer.from(left, 'base64')
    const rightBuffer = Buffer.from(right, 'base64')

    if (leftBuffer.length !== rightBuffer.length) return false

    return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}
