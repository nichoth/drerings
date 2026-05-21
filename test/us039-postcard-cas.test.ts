import {
    describe, expect, it, vi, beforeEach, afterEach
} from 'vitest'
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

describe('US-039 postcard CAS state machine', () => {
    beforeEach(() => {
        vi.doUnmock('@netlify/database')
        vi.doUnmock('@netlify/blobs')
        vi.doUnmock('../netlify/lib/session.js')
        vi.doUnmock('../netlify/lib/stamps.js')
        vi.doUnmock('../netlify/lib/postcards.js')
        vi.doUnmock('../netlify/lib/posts.js')
        vi.doUnmock('../netlify/lib/drawing-images.js')
        vi.doUnmock('../netlify/lib/resend.js')
        vi.mock('../netlify/lib/rate-limit.js')
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    it(
        'AC15.1 happy path: fresh queued postcard → CAS ok → ' +
        'debit → send → attachLotAndMarkSent → 200',
        async () => {
            const query = vi.fn<Query>(async (sql:string) => {
                if (sql.includes('SELECT blob_key')) {
                    return {
                        rows: [{
                            blob_key: 'users/user-1/drawings/drawing-1.png',
                            text: 'hello',
                            alt_text: 'alt'
                        }]
                    }
                }
                if (sql.includes('SELECT 1') &&
                    sql.includes('FROM drawings')) {
                    return { rows: [{ 1: 1 }] }
                }
                return { rows: [] }
            })

            const transitionMock = vi.fn().mockResolvedValue({ ok: true })
            const debitMock = vi.fn().mockResolvedValue({
                lotId: 'lot-1',
                balanceAfter: 4
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
                        handle: 'test.bsky.social'
                    }
                })
            }))

            vi.doMock('../netlify/lib/posts.js', () => ({
                userOwnsDrawing: vi.fn().mockResolvedValue(true)
            }))

            vi.doMock('../netlify/lib/postcards.js', () => ({
                findOrCreateQueuedPostcard:
                    vi.fn().mockResolvedValue({
                        postcard: {
                            id: 'postcard-1',
                            sender_id: 'user-1',
                            drawing_id: 'drawing-1',
                            recipient_email: 'recipient@example.com',
                            lot_id: null,
                            resend_email_id: null,
                            status: 'queued',
                            idempotency_key: null,
                            created_at: new Date().toISOString()
                        },
                        reused: false
                    }),
                transitionPostcardToDebiting: transitionMock,
                attachLotAndMarkSent:
                    vi.fn().mockResolvedValue(undefined),
                markFailedRefunded:
                    vi.fn().mockResolvedValue(undefined),
                deleteIfQueued: vi.fn().mockResolvedValue(undefined),
                rollbackDebitingToQueued:
                    vi.fn().mockResolvedValue(undefined)
            }))

            vi.doMock('../netlify/lib/drawing-images.js', () => ({
                getDrawingImage: vi.fn().mockResolvedValue(
                    Buffer.from('fake-png')
                )
            }))

            vi.doMock('../netlify/lib/resend.js', () => ({
                sendPostcardEmail: vi.fn().mockResolvedValue('re_test')
            }))

            vi.doMock('../netlify/lib/stamps.js', async () => {
                const actual = await vi.importActual(
                    '../netlify/lib/stamps.js'
                )
                return {
                    ...actual,
                    debitStamp: debitMock,
                    InsufficientStampsError:
                        (actual as {
                            InsufficientStampsError:unknown
                        }).InsufficientStampsError
                }
            })

            vi.doMock('../netlify/lib/rate-limit.js', () => ({
                checkAndIncrement:
                    vi.fn().mockResolvedValue({
                        allowed: true,
                        remaining: 29,
                        resetAt: new Date(Date.now() + 60 * 1000)
                    }),
                getClientIp: vi.fn((e) => e.headers?.ip || 'unknown'),
                rateLimitResponse: vi.fn()
            }))

            const { handler } = await import(
                '../netlify/functions/postcards-send.js'
            )

            const event = buildPostEvent(
                '/.netlify/functions/postcards-send',
                JSON.stringify({
                    drawing_id: 'drawing-1',
                    recipient_email: 'recipient@example.com'
                })
            )

            const response = await handler(event, context)

            expect(response).toBeTruthy()
            if (!response) throw new Error('No response')
            expect(response.statusCode).toBe(200)

            const body = JSON.parse(response.body || '{}')
            expect(body.id).toBe('postcard-1')
            expect(body.balance_after).toBe(4)

            // Verify CAS was called BEFORE debit
            expect(transitionMock).toHaveBeenCalledBefore(debitMock)
        }
    )

    it(
        'AC15.2 resurrection success: stuck queued postcard ' +
        '>10 minutes old → CAS ok → 200',
        async () => {
            const createdAt = new Date(
                Date.now() - 15 * 60 * 1000
            ).toISOString()

            const query = vi.fn<Query>(async (sql:string) => {
                if (sql.includes('SELECT blob_key')) {
                    return {
                        rows: [{
                            blob_key: 'users/user-1/drawings/drawing-1.png',
                            text: 'hello',
                            alt_text: 'alt'
                        }]
                    }
                }
                if (sql.includes('SELECT 1') &&
                    sql.includes('FROM drawings')) {
                    return { rows: [{ 1: 1 }] }
                }
                return { rows: [] }
            })

            const transitionMock = vi.fn().mockResolvedValue({ ok: true })
            const debitMock = vi.fn().mockResolvedValue({
                lotId: 'lot-1',
                balanceAfter: 4
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
                        handle: 'test.bsky.social'
                    }
                })
            }))

            vi.doMock('../netlify/lib/posts.js', () => ({
                userOwnsDrawing: vi.fn().mockResolvedValue(true)
            }))

            vi.doMock('../netlify/lib/postcards.js', () => ({
                findOrCreateQueuedPostcard:
                    vi.fn().mockResolvedValue({
                        postcard: {
                            id: 'postcard-1',
                            sender_id: 'user-1',
                            drawing_id: 'drawing-1',
                            recipient_email: 'recipient@example.com',
                            lot_id: null,
                            resend_email_id: null,
                            status: 'queued',
                            idempotency_key: 'key-1',
                            created_at: createdAt
                        },
                        reused: true
                    }),
                transitionPostcardToDebiting: transitionMock,
                attachLotAndMarkSent:
                    vi.fn().mockResolvedValue(undefined),
                markFailedRefunded:
                    vi.fn().mockResolvedValue(undefined),
                deleteIfQueued: vi.fn().mockResolvedValue(undefined),
                rollbackDebitingToQueued:
                    vi.fn().mockResolvedValue(undefined)
            }))

            vi.doMock('../netlify/lib/drawing-images.js', () => ({
                getDrawingImage: vi.fn().mockResolvedValue(
                    Buffer.from('fake-png')
                )
            }))

            vi.doMock('../netlify/lib/resend.js', () => ({
                sendPostcardEmail: vi.fn().mockResolvedValue('re_test')
            }))

            vi.doMock('../netlify/lib/stamps.js', async () => {
                const actual = await vi.importActual(
                    '../netlify/lib/stamps.js'
                )
                return {
                    ...actual,
                    debitStamp: debitMock,
                    InsufficientStampsError:
                        (actual as {
                            InsufficientStampsError:unknown
                        }).InsufficientStampsError
                }
            })

            vi.doMock('../netlify/lib/rate-limit.js', () => ({
                checkAndIncrement:
                    vi.fn().mockResolvedValue({
                        allowed: true,
                        remaining: 29,
                        resetAt: new Date(Date.now() + 60 * 1000)
                    }),
                getClientIp: vi.fn((e) => e.headers?.ip || 'unknown'),
                rateLimitResponse: vi.fn()
            }))

            const { handler } = await import(
                '../netlify/functions/postcards-send.js'
            )

            const event = buildPostEvent(
                '/.netlify/functions/postcards-send',
                JSON.stringify({
                    drawing_id: 'drawing-1',
                    recipient_email: 'recipient@example.com',
                    idempotency_key: 'key-1'
                })
            )

            const response = await handler(event, context)

            expect(response).toBeTruthy()
            if (!response) throw new Error('No response')
            expect(response.statusCode).toBe(200)
            expect(transitionMock).toHaveBeenCalled()
        }
    )

    it(
        'AC15.3 resurrection concurrent: two parallel retries, ' +
        'first CAS wins → 200, second loses → 409 send_in_progress',
        async () => {
            // This mock-based test verifies handler control-flow only:
            // one CAS call returns ok:true, the other ok:false status
            // 'debiting', proving exactly one proceeds to debit. The test
            // does NOT model Postgres UPDATE...WHERE arbitration. A real-DB
            // integration test would be needed to verify atomicity at the
            // storage layer (e.g., spawning concurrent connections and
            // observing the exact one-winner guarantee of the CAS UPDATE).

            const createdAt = new Date(
                Date.now() - 15 * 60 * 1000
            ).toISOString()

            const query = vi.fn<Query>(async (sql:string) => {
                if (sql.includes('SELECT blob_key')) {
                    return {
                        rows: [{
                            blob_key: 'users/user-1/drawings/drawing-1.png',
                            text: 'hello',
                            alt_text: 'alt'
                        }]
                    }
                }
                if (sql.includes('SELECT 1') &&
                    sql.includes('FROM drawings')) {
                    return { rows: [{ 1: 1 }] }
                }
                return { rows: [] }
            })

            // CAS returns ok:true first call, ok:false second call
            let callCount = 0
            const transitionMock = vi.fn(async () => {
                callCount++
                if (callCount === 1) {
                    return { ok: true }
                }
                return { ok: false, status: 'debiting' }
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
                        handle: 'test.bsky.social'
                    }
                })
            }))

            vi.doMock('../netlify/lib/posts.js', () => ({
                userOwnsDrawing: vi.fn().mockResolvedValue(true)
            }))

            vi.doMock('../netlify/lib/postcards.js', () => ({
                findOrCreateQueuedPostcard:
                    vi.fn().mockResolvedValue({
                        postcard: {
                            id: 'postcard-1',
                            sender_id: 'user-1',
                            drawing_id: 'drawing-1',
                            recipient_email: 'recipient@example.com',
                            lot_id: null,
                            resend_email_id: null,
                            status: 'queued',
                            idempotency_key: null,
                            created_at: createdAt
                        },
                        reused: true
                    }),
                transitionPostcardToDebiting: transitionMock,
                attachLotAndMarkSent:
                    vi.fn().mockResolvedValue(undefined),
                markFailedRefunded:
                    vi.fn().mockResolvedValue(undefined),
                deleteIfQueued: vi.fn().mockResolvedValue(undefined),
                rollbackDebitingToQueued:
                    vi.fn().mockResolvedValue(undefined)
            }))

            vi.doMock('../netlify/lib/drawing-images.js', () => ({
                getDrawingImage: vi.fn().mockResolvedValue(
                    Buffer.from('fake-png')
                )
            }))

            vi.doMock('../netlify/lib/resend.js', () => ({
                sendPostcardEmail: vi.fn().mockResolvedValue('re_test')
            }))

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
                    InsufficientStampsError:
                        (actual as {
                            InsufficientStampsError:unknown
                        }).InsufficientStampsError
                }
            })

            const { handler } = await import(
                '../netlify/functions/postcards-send.js'
            )

            const event = buildPostEvent(
                '/.netlify/functions/postcards-send',
                JSON.stringify({
                    drawing_id: 'drawing-1',
                    recipient_email: 'recipient@example.com'
                })
            )

            // Fire both in parallel
            const results = await Promise.allSettled([
                handler(event, context),
                handler(event, context)
            ])

            const responses = results
                .filter(r => r.status === 'fulfilled')
                .map(r => (r as PromiseFulfilledResult<any>).value)
                .filter(Boolean)

            expect(responses).toHaveLength(2)

            // One should be 200, one should be 409
            const statusCodes = responses
                .map((r:any) => r.statusCode)
                .sort()

            expect(statusCodes).toEqual([200, 409])

            // Find the 409 response and verify it's send_in_progress
            const failedResponse = responses.find(
                (r:any) => r.statusCode === 409
            )
            if (failedResponse) {
                const failedBody = JSON.parse(
                    failedResponse.body || '{}'
                )
                expect(failedBody.error).toBe('send_in_progress')
            }
        }
    )

    it(
        'AC15.4 failed send: CAS ok → debit → sendPostcardEmail ' +
        'throws → refundFailedSend called → ' +
        'markFailedRefunded called → 502',
        async () => {
            const query = vi.fn<Query>(async (sql:string) => {
                if (sql.includes('SELECT blob_key')) {
                    return {
                        rows: [{
                            blob_key: 'users/user-1/drawings/drawing-1.png',
                            text: 'hello',
                            alt_text: 'alt'
                        }]
                    }
                }
                if (sql.includes('SELECT 1') &&
                    sql.includes('FROM drawings')) {
                    return { rows: [{ 1: 1 }] }
                }
                return { rows: [] }
            })

            const transitionMock = vi.fn().mockResolvedValue({ ok: true })
            const debitMock = vi.fn().mockResolvedValue({
                lotId: 'lot-1',
                balanceAfter: 4
            })
            const refundMock = vi.fn().mockResolvedValue({
                lotId: 'lot-1',
                balanceAfter: 5
            })
            const markFailedRefundedMock = vi.fn()
                .mockResolvedValue(undefined)

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
                        handle: 'test.bsky.social'
                    }
                })
            }))

            vi.doMock('../netlify/lib/posts.js', () => ({
                userOwnsDrawing: vi.fn().mockResolvedValue(true)
            }))

            vi.doMock('../netlify/lib/postcards.js', () => ({
                findOrCreateQueuedPostcard:
                    vi.fn().mockResolvedValue({
                        postcard: {
                            id: 'postcard-1',
                            sender_id: 'user-1',
                            drawing_id: 'drawing-1',
                            recipient_email: 'recipient@example.com',
                            lot_id: null,
                            resend_email_id: null,
                            status: 'queued',
                            idempotency_key: null,
                            created_at: new Date().toISOString()
                        },
                        reused: false
                    }),
                transitionPostcardToDebiting: transitionMock,
                attachLotAndMarkSent:
                    vi.fn().mockResolvedValue(undefined),
                markFailedRefunded: markFailedRefundedMock,
                deleteIfQueued: vi.fn().mockResolvedValue(undefined),
                rollbackDebitingToQueued:
                    vi.fn().mockResolvedValue(undefined)
            }))

            vi.doMock('../netlify/lib/drawing-images.js', () => ({
                getDrawingImage: vi.fn().mockResolvedValue(
                    Buffer.from('fake-png')
                )
            }))

            vi.doMock('../netlify/lib/resend.js', () => ({
                sendPostcardEmail: vi.fn().mockRejectedValue(
                    new Error('Resend failed')
                )
            }))

            vi.doMock('../netlify/lib/stamps.js', async () => {
                const actual = await vi.importActual(
                    '../netlify/lib/stamps.js'
                )
                return {
                    ...actual,
                    debitStamp: debitMock,
                    refundFailedSend: refundMock,
                    InsufficientStampsError:
                        (actual as {
                            InsufficientStampsError:unknown
                        }).InsufficientStampsError
                }
            })

            const { handler } = await import(
                '../netlify/functions/postcards-send.js'
            )

            const event = buildPostEvent(
                '/.netlify/functions/postcards-send',
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

            // Verify refund and mark failed refunded were called
            expect(refundMock).toHaveBeenCalledWith({
                userId: 'user-1',
                lotId: 'lot-1'
            })
            expect(markFailedRefundedMock).toHaveBeenCalledWith(
                'postcard-1'
            )
        }
    )

    it(
        'AC15.5 idempotent sent: reused row with status=sent → ' +
        '200 with balance, no CAS/debit called',
        async () => {
            const getCurrent = vi.fn<Query>(async (sql:string) => {
                if (sql.includes('SELECT stamps_balance')) {
                    return { rows: [{ stamps_balance: 4 }] }
                }
                if (sql.includes('SELECT blob_key')) {
                    return {
                        rows: [{
                            blob_key: 'users/user-1/drawings/drawing-1.png',
                            text: 'hello',
                            alt_text: 'alt'
                        }]
                    }
                }
                if (sql.includes('SELECT 1') &&
                    sql.includes('FROM drawings')) {
                    return { rows: [{ 1: 1 }] }
                }
                return { rows: [] }
            })

            const transitionMock = vi.fn()
            const debitMock = vi.fn()

            vi.doMock('@netlify/database', () => ({
                getDatabase: () => ({
                    pool: {
                        query: getCurrent,
                        connect: vi.fn(async () => ({
                            query: getCurrent,
                            release: vi.fn()
                        }))
                    }
                })
            }))

            vi.doMock('../netlify/lib/session.js', () => ({
                getSession: vi.fn().mockResolvedValue({
                    user: {
                        id: 'user-1',
                        handle: 'test.bsky.social'
                    }
                })
            }))

            vi.doMock('../netlify/lib/posts.js', () => ({
                userOwnsDrawing: vi.fn().mockResolvedValue(true)
            }))

            vi.doMock('../netlify/lib/postcards.js', () => ({
                findOrCreateQueuedPostcard:
                    vi.fn().mockResolvedValue({
                        postcard: {
                            id: 'postcard-1',
                            sender_id: 'user-1',
                            drawing_id: 'drawing-1',
                            recipient_email: 'recipient@example.com',
                            lot_id: 'lot-1',
                            resend_email_id: 're_sent',
                            status: 'sent',
                            idempotency_key: 'key-1',
                            created_at: new Date().toISOString()
                        },
                        reused: true
                    }),
                transitionPostcardToDebiting: transitionMock,
                attachLotAndMarkSent:
                    vi.fn().mockResolvedValue(undefined),
                markFailedRefunded:
                    vi.fn().mockResolvedValue(undefined),
                deleteIfQueued: vi.fn().mockResolvedValue(undefined),
                rollbackDebitingToQueued:
                    vi.fn().mockResolvedValue(undefined)
            }))

            vi.doMock('../netlify/lib/stamps.js', async () => {
                const actual = await vi.importActual(
                    '../netlify/lib/stamps.js'
                )
                return {
                    ...actual,
                    debitStamp: debitMock,
                    InsufficientStampsError:
                        (actual as {
                            InsufficientStampsError:unknown
                        }).InsufficientStampsError
                }
            })

            vi.doMock('../netlify/lib/rate-limit.js', () => ({
                checkAndIncrement:
                    vi.fn().mockResolvedValue({
                        allowed: true,
                        remaining: 29,
                        resetAt: new Date(Date.now() + 60 * 1000)
                    }),
                getClientIp: vi.fn((e) => e.headers?.ip || 'unknown'),
                rateLimitResponse: vi.fn()
            }))

            const { handler } = await import(
                '../netlify/functions/postcards-send.js'
            )

            const event = buildPostEvent(
                '/.netlify/functions/postcards-send',
                JSON.stringify({
                    drawing_id: 'drawing-1',
                    recipient_email: 'recipient@example.com',
                    idempotency_key: 'key-1'
                })
            )

            const response = await handler(event, context)

            expect(response).toBeTruthy()
            if (!response) throw new Error('No response')
            expect(response.statusCode).toBe(200)

            const body = JSON.parse(response.body || '{}')
            expect(body.balance_after).toBe(4)

            // CAS and debit should NOT have been called
            expect(transitionMock).not.toHaveBeenCalled()
            expect(debitMock).not.toHaveBeenCalled()
        }
    )

    it(
        'AC15.6 previously failed: reused row with ' +
        'status=failed_refunded → 409 send_previously_failed, ' +
        'CAS not called',
        async () => {
            const query = vi.fn<Query>(async (sql:string) => {
                if (sql.includes('SELECT blob_key')) {
                    return {
                        rows: [{
                            blob_key: 'users/user-1/drawings/drawing-1.png',
                            text: 'hello',
                            alt_text: 'alt'
                        }]
                    }
                }
                if (sql.includes('SELECT 1') &&
                    sql.includes('FROM drawings')) {
                    return { rows: [{ 1: 1 }] }
                }
                return { rows: [] }
            })

            const transitionMock = vi.fn()

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
                        handle: 'test.bsky.social'
                    }
                })
            }))

            vi.doMock('../netlify/lib/posts.js', () => ({
                userOwnsDrawing: vi.fn().mockResolvedValue(true)
            }))

            vi.doMock('../netlify/lib/postcards.js', () => ({
                findOrCreateQueuedPostcard:
                    vi.fn().mockResolvedValue({
                        postcard: {
                            id: 'postcard-1',
                            sender_id: 'user-1',
                            drawing_id: 'drawing-1',
                            recipient_email: 'recipient@example.com',
                            lot_id: 'lot-1',
                            resend_email_id: 're_failed',
                            status: 'failed_refunded',
                            idempotency_key: 'key-1',
                            created_at: new Date().toISOString()
                        },
                        reused: true
                    }),
                transitionPostcardToDebiting: transitionMock,
                attachLotAndMarkSent:
                    vi.fn().mockResolvedValue(undefined),
                markFailedRefunded:
                    vi.fn().mockResolvedValue(undefined),
                deleteIfQueued: vi.fn().mockResolvedValue(undefined),
                rollbackDebitingToQueued:
                    vi.fn().mockResolvedValue(undefined)
            }))

            const { handler } = await import(
                '../netlify/functions/postcards-send.js'
            )

            const event = buildPostEvent(
                '/.netlify/functions/postcards-send',
                JSON.stringify({
                    drawing_id: 'drawing-1',
                    recipient_email: 'recipient@example.com',
                    idempotency_key: 'key-1'
                })
            )

            const response = await handler(event, context)

            expect(response).toBeTruthy()
            if (!response) throw new Error('No response')
            expect(response.statusCode).toBe(409)

            const body = JSON.parse(response.body || '{}')
            expect(body.error).toBe('send_previously_failed')

            // CAS should NOT have been called
            expect(transitionMock).not.toHaveBeenCalled()
        }
    )

    it(
        'AC15.7 reused debiting: reused row with status=debiting ' +
        '(regardless of created_at) → 409 send_in_progress, ' +
        'CAS not called',
        async () => {
            const createdAt = new Date(
                Date.now() - 15 * 60 * 1000
            ).toISOString()

            const query = vi.fn<Query>(async (sql:string) => {
                if (sql.includes('SELECT blob_key')) {
                    return {
                        rows: [{
                            blob_key: 'users/user-1/drawings/drawing-1.png',
                            text: 'hello',
                            alt_text: 'alt'
                        }]
                    }
                }
                if (sql.includes('SELECT 1') &&
                    sql.includes('FROM drawings')) {
                    return { rows: [{ 1: 1 }] }
                }
                return { rows: [] }
            })

            const transitionMock = vi.fn()

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
                        handle: 'test.bsky.social'
                    }
                })
            }))

            vi.doMock('../netlify/lib/posts.js', () => ({
                userOwnsDrawing: vi.fn().mockResolvedValue(true)
            }))

            vi.doMock('../netlify/lib/postcards.js', () => ({
                findOrCreateQueuedPostcard:
                    vi.fn().mockResolvedValue({
                        postcard: {
                            id: 'postcard-1',
                            sender_id: 'user-1',
                            drawing_id: 'drawing-1',
                            recipient_email: 'recipient@example.com',
                            lot_id: null,
                            resend_email_id: null,
                            status: 'debiting',
                            idempotency_key: null,
                            created_at: createdAt
                        },
                        reused: true
                    }),
                transitionPostcardToDebiting: transitionMock,
                attachLotAndMarkSent:
                    vi.fn().mockResolvedValue(undefined),
                markFailedRefunded:
                    vi.fn().mockResolvedValue(undefined),
                deleteIfQueued: vi.fn().mockResolvedValue(undefined),
                rollbackDebitingToQueued:
                    vi.fn().mockResolvedValue(undefined)
            }))

            const { handler } = await import(
                '../netlify/functions/postcards-send.js'
            )

            const event = buildPostEvent(
                '/.netlify/functions/postcards-send',
                JSON.stringify({
                    drawing_id: 'drawing-1',
                    recipient_email: 'recipient@example.com'
                })
            )

            const response = await handler(event, context)

            expect(response).toBeTruthy()
            if (!response) throw new Error('No response')
            expect(response.statusCode).toBe(409)

            const body = JSON.parse(response.body || '{}')
            expect(body.error).toBe('send_in_progress')

            // CAS should NOT have been called — old age does not matter
            expect(transitionMock).not.toHaveBeenCalled()
        }
    )

    it(
        'AC15.8 InsufficientStampsError recovery: CAS ok → ' +
        'debitStamp throws InsufficientStampsError → ' +
        'rollbackDebitingToQueued called → 402 insufficient_stamps',
        async () => {
            const query = vi.fn<Query>(async (sql:string) => {
                if (sql.includes('SELECT blob_key')) {
                    return {
                        rows: [{
                            blob_key: 'users/user-1/drawings/drawing-1.png',
                            text: 'hello',
                            alt_text: 'alt'
                        }]
                    }
                }
                if (sql.includes('SELECT 1') &&
                    sql.includes('FROM drawings')) {
                    return { rows: [{ 1: 1 }] }
                }
                return { rows: [] }
            })

            const transitionMock = vi.fn().mockResolvedValue({ ok: true })
            const rollbackMock = vi.fn().mockResolvedValue(undefined)

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
                        handle: 'test.bsky.social'
                    }
                })
            }))

            vi.doMock('../netlify/lib/posts.js', () => ({
                userOwnsDrawing: vi.fn().mockResolvedValue(true)
            }))

            vi.doMock('../netlify/lib/postcards.js', () => ({
                findOrCreateQueuedPostcard:
                    vi.fn().mockResolvedValue({
                        postcard: {
                            id: 'postcard-1',
                            sender_id: 'user-1',
                            drawing_id: 'drawing-1',
                            recipient_email: 'recipient@example.com',
                            lot_id: null,
                            resend_email_id: null,
                            status: 'queued',
                            idempotency_key: null,
                            created_at: new Date().toISOString()
                        },
                        reused: false
                    }),
                transitionPostcardToDebiting: transitionMock,
                attachLotAndMarkSent:
                    vi.fn().mockResolvedValue(undefined),
                markFailedRefunded:
                    vi.fn().mockResolvedValue(undefined),
                deleteIfQueued: vi.fn().mockResolvedValue(undefined),
                rollbackDebitingToQueued: rollbackMock
            }))

            vi.doMock('../netlify/lib/drawing-images.js', () => ({
                getDrawingImage: vi.fn().mockResolvedValue(
                    Buffer.from('fake-png')
                )
            }))

            vi.doMock('../netlify/lib/stamps.js', async () => {
                const actual = await vi.importActual(
                    '../netlify/lib/stamps.js'
                )
                const InsufficientStampsError = (actual as {
                    InsufficientStampsError:unknown
                }).InsufficientStampsError
                return {
                    ...actual,
                    debitStamp: vi.fn().mockRejectedValue(
                        new (InsufficientStampsError as any)()
                    ),
                    InsufficientStampsError
                }
            })

            const { handler } = await import(
                '../netlify/functions/postcards-send.js'
            )

            const event = buildPostEvent(
                '/.netlify/functions/postcards-send',
                JSON.stringify({
                    drawing_id: 'drawing-1',
                    recipient_email: 'recipient@example.com'
                })
            )

            const response = await handler(event, context)

            expect(response).toBeTruthy()
            if (!response) throw new Error('No response')
            expect(response.statusCode).toBe(402)

            const body = JSON.parse(response.body || '{}')
            expect(body.error).toBe('insufficient_stamps')

            // Rollback should have been called with postcard id
            expect(rollbackMock).toHaveBeenCalledWith('postcard-1')
        }
    )
})
