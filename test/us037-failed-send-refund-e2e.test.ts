import {
    describe, expect, it, vi, beforeEach, afterEach
} from 'vitest'
import crypto from 'node:crypto'
import type { HandlerEvent, HandlerContext } from '@netlify/functions'

type QueryRow = Record<string, unknown>
type Query = (
    sql:string,
    params?:unknown[]
) => Promise<{ rows:QueryRow[] }>

const context = {} as HandlerContext

function buildPostEvent (
    path:string,
    body:string,
    headers:Record<string, string> = {}
):HandlerEvent {
    return {
        httpMethod: 'POST',
        body,
        isBase64Encoded: false,
        headers: { 'content-type': 'application/json', ...headers },
        rawUrl: `http://localhost${path}`,
        rawQuery: '',
        path,
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null
    } as HandlerEvent
}

function svixSignedHeaders (
    secret:string,
    body:string
):Record<string, string> {
    const messageId = 'msg_test_' + crypto.randomBytes(4).toString('hex')
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    const digest = crypto
        .createHmac('sha256', key)
        .update(`${messageId}.${timestamp}.${body}`)
        .digest('base64')

    return {
        'svix-id': messageId,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${digest}`
    }
}

describe('US-037 end-to-end failed send refund', () => {
    beforeEach(() => {
        vi.doUnmock('@netlify/database')
        vi.doUnmock('@netlify/blobs')
        vi.doUnmock('../netlify/lib/session.js')
        vi.doUnmock('../netlify/lib/stamps.js')
        vi.doUnmock('../netlify/lib/postcards.js')
        vi.doUnmock('../netlify/lib/posts.js')
        vi.doUnmock('../netlify/lib/drawing-images.js')
        vi.doUnmock('../netlify/lib/resend.js')
        vi.doUnmock('../netlify/lib/resend-webhook.js')
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    it(
        'AC13.1 sync refund path: blob unavailable returns 502 ' +
        'and refunds via refundFailedSend',
        async () => {
            const query = vi.fn<Query>(async (sql:string) => {
                if (sql.includes('SELECT blob_key') &&
                    sql.includes('FROM drawings')) {
                    return {
                        rows: [{
                            blob_key:
                                'users/user-1/drawings/drawing-1.png',
                            text: 'hello',
                            alt_text: 'alt'
                        }]
                    }
                }
                return { rows: [] }
            })
            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: {
                        query,
                        connect: vi.fn(async () => ({
                            query,
                            release: vi.fn()
                        }))
                    }
                })
            }))

            vi.doMock('../netlify/lib/session.js', () => ({
                getSession: vi.fn().mockResolvedValue({
                    user: {
                        id: 'user-1',
                        email: 'sender@example.com'
                    }
                })
            }))

            vi.doMock('../netlify/lib/posts.js', () => ({
                userOwnsDrawing: vi.fn().mockResolvedValue(true)
            }))

            vi.doMock('../netlify/lib/postcards.js', () => ({
                findOrCreateQueuedPostcard: vi.fn().mockResolvedValue({
                    postcard: {
                        id: 'postcard-1',
                        sender_id: 'user-1',
                        drawing_id: 'drawing-1',
                        recipient_email: 'recipient@example.com',
                        lot_id: null,
                        resend_email_id: null,
                        status: 'queued',
                        idempotency_key: null,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    },
                    reused: false
                }),
                markFailedRefunded: vi.fn().mockResolvedValue(undefined),
                deleteIfQueued: vi.fn().mockResolvedValue(undefined),
                attachLotAndMarkSent:
                    vi.fn().mockResolvedValue(undefined)
            }))

            vi.doMock('../netlify/lib/drawing-images.js', () => ({
                getDrawingImage: vi.fn().mockRejectedValue(
                    new Error('blob unavailable')
                )
            }))

            const refundFailedSend = vi.fn().mockResolvedValue({
                lotId: 'lot-1',
                balanceAfter: 5
            })

            vi.doMock('../netlify/lib/stamps.js', async () => {
                const actual = await vi.importActual(
                    '../netlify/lib/stamps.js'
                )
                return {
                    ...actual,
                    debitStamp: vi.fn().mockResolvedValue({
                        lotId: 'lot-1',
                        balanceAfter: 4
                    }),
                    refundFailedSend,
                    InsufficientStampsError:
                        (actual as {
                            InsufficientStampsError:unknown
                        }).InsufficientStampsError
                }
            })

            const { handler } = await import(
                '../netlify/functions/postcards/send.js'
            )

            const event = buildPostEvent(
                '/.netlify/functions/postcards/send',
                JSON.stringify({
                    drawing_id: 'drawing-1',
                    recipient_email: 'recipient@example.com'
                })
            )

            const response = await handler(event, context)

            expect(response).toBeTruthy()
            if (!response) throw new Error('No response')
            expect(response.statusCode).toBe(502)
            const body = JSON.parse(response.body || '{}')
            expect(body.error).toBe('send_failed')
            expect(refundFailedSend).toHaveBeenCalledWith({
                userId: 'user-1',
                lotId: 'lot-1'
            })
        }
    )

    it(
        'AC13.2 async refund path: webhooks/resend hard bounce ' +
        'verifies Svix signature and triggers refundFailedSend',
        async () => {
            const secret = 'whsec_' +
                Buffer.from('secret-bytes-32-chars-long-aaaaa')
                    .toString('base64')
            vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)

            const refundFailedSend = vi.fn().mockResolvedValue({
                lotId: 'lot-1',
                balanceAfter: 9
            })
            const markFailedRefunded = vi.fn().mockResolvedValue(
                undefined
            )
            const getPostcardByResendEmailId = vi.fn().mockResolvedValue(
                {
                    id: 'postcard-1',
                    sender_id: 'user-1',
                    lot_id: 'lot-1',
                    status: 'sent'
                }
            )

            vi.doMock('../netlify/lib/stamps.js', () => ({
                refundFailedSend
            }))
            vi.doMock('../netlify/lib/postcards.js', () => ({
                getPostcardByResendEmailId,
                markFailedRefunded
            }))

            const { handler } = await import(
                '../netlify/functions/webhooks/resend.js'
            )

            const body = JSON.stringify({
                type: 'email.bounced',
                data: {
                    email_id: 're_test123',
                    bounce: { type: 'hard_bounce' }
                }
            })

            const event = buildPostEvent(
                '/.netlify/functions/webhooks/resend',
                body,
                svixSignedHeaders(secret, body)
            )

            const response = await handler(event, context)

            expect(response).toBeTruthy()
            if (!response) throw new Error('No response')
            expect(response.statusCode).toBe(200)
            const result = JSON.parse(response.body || '{}')
            expect(result.received).toBe(true)
            expect(result.refunded).toBe(true)
            expect(refundFailedSend).toHaveBeenCalledWith({
                userId: 'user-1',
                lotId: 'lot-1'
            })
            expect(markFailedRefunded).toHaveBeenCalledWith('postcard-1')
        }
    )

    it(
        'AC13.2 async path rejects request with bad signature ' +
        '(no refund triggered)',
        async () => {
            const secret = 'whsec_' +
                Buffer.from('secret-bytes-32-chars-long-aaaaa')
                    .toString('base64')
            vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)

            const refundFailedSend = vi.fn()
            const markFailedRefunded = vi.fn()
            const getPostcardByResendEmailId = vi.fn()

            vi.doMock('../netlify/lib/stamps.js', () => ({
                refundFailedSend
            }))
            vi.doMock('../netlify/lib/postcards.js', () => ({
                getPostcardByResendEmailId,
                markFailedRefunded
            }))

            const { handler } = await import(
                '../netlify/functions/webhooks/resend.js'
            )

            const body = JSON.stringify({
                type: 'email.bounced',
                data: {
                    email_id: 're_test123',
                    bounce: { type: 'hard_bounce' }
                }
            })

            // Sign with a DIFFERENT secret to produce a bad signature.
            const wrongSecret = 'whsec_' +
                Buffer.from('different-bytes-32-chars-long-bbbb')
                    .toString('base64')

            const event = buildPostEvent(
                '/.netlify/functions/webhooks/resend',
                body,
                svixSignedHeaders(wrongSecret, body)
            )

            const response = await handler(event, context)

            expect(response).toBeTruthy()
            if (!response) throw new Error('No response')
            expect(response.statusCode).toBe(400)
            const result = JSON.parse(response.body || '{}')
            expect(result.error).toBe('invalid_signature')
            expect(getPostcardByResendEmailId).not.toHaveBeenCalled()
            expect(refundFailedSend).not.toHaveBeenCalled()
            expect(markFailedRefunded).not.toHaveBeenCalled()
        }
    )

    it(
        'AC13.3 double-fault: already-refunded postcard is a no-op',
        async () => {
            const secret = 'whsec_' +
                Buffer.from('secret-bytes-32-chars-long-aaaaa')
                    .toString('base64')
            vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)

            const refundFailedSend = vi.fn()
            const markFailedRefunded = vi.fn()
            const getPostcardByResendEmailId = vi.fn().mockResolvedValue(
                {
                    id: 'postcard-1',
                    sender_id: 'user-1',
                    lot_id: 'lot-1',
                    status: 'failed_refunded'
                }
            )

            vi.doMock('../netlify/lib/stamps.js', () => ({
                refundFailedSend
            }))
            vi.doMock('../netlify/lib/postcards.js', () => ({
                getPostcardByResendEmailId,
                markFailedRefunded
            }))

            const { handler } = await import(
                '../netlify/functions/webhooks/resend.js'
            )

            const body = JSON.stringify({
                type: 'email.bounced',
                data: {
                    email_id: 're_test123',
                    bounce: { type: 'hard_bounce' }
                }
            })

            const event = buildPostEvent(
                '/.netlify/functions/webhooks/resend',
                body,
                svixSignedHeaders(secret, body)
            )

            const response = await handler(event, context)

            expect(response).toBeTruthy()
            if (!response) throw new Error('No response')
            expect(response.statusCode).toBe(200)
            const result = JSON.parse(response.body || '{}')
            expect(result.received).toBe(true)
            expect(result.refunded).toBe(false)
            expect(result.reason).toBe('already_refunded')
            expect(refundFailedSend).not.toHaveBeenCalled()
            expect(markFailedRefunded).not.toHaveBeenCalled()
        }
    )
})
