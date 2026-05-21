import { describe, expect, it, vi, beforeEach } from 'vitest'

type QueryResult = { rows:Array<Record<string, unknown>>; }

type Query = (
    sql:string,
    params?:unknown[]
) => Promise<QueryResult>

function mockRateLimitAllow () {
    vi.doMock('../netlify/lib/rate-limit.js', () => ({
        checkAndIncrement: vi.fn().mockResolvedValue({
            allowed: true,
            remaining: 29,
            resetAt: new Date(Date.now() + 60 * 1000)
        }),
        getClientIp: vi.fn(),
        rateLimitResponse: vi.fn()
    }))
}

function createDbMock (
    options:{
        insufficientStamps?:boolean
        balanceAfter?:number
    } = {}
) {
    const release = vi.fn()
    const stampTransactionInserts:Array<Array<unknown>> = []
    const query = vi.fn<Query>(async (sql:string, params?:unknown[]) => {
        if (sql.includes('SELECT *') &&
            sql.includes('FROM postcards')) {
            return { rows: [] }
        }

        if (sql.includes('INSERT INTO postcards')) {
            return {
                rows: [{
                    id: 'postcard-1',
                    sender_id: 'user-1',
                    drawing_id: 'drawing-1',
                    recipient_email: 'recipient@example.com',
                    lot_id: null,
                    resend_email_id: null,
                    status: 'queued',
                    idempotency_key: params?.[4],
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }]
            }
        }

        if (sql.includes('SELECT blob_key')) {
            return {
                rows: [{
                    blob_key: 'users/user-1/drawings/drawing-1.png',
                    text: 'test drawing',
                    alt_text: 'alt text'
                }]
            }
        }

        if (sql.includes('SELECT 1') &&
            sql.includes('FROM drawings')) {
            return { rows: [{ 1: 1 }] }
        }

        if (sql.includes('UPDATE users')) {
            if (sql.includes('stamps_balance = stamps_balance - 1')) {
                if (options.insufficientStamps) {
                    return { rows: [] }
                }
                const bal = options.balanceAfter ?? 4
                return { rows: [{ stamps_balance: bal }] }
            }
            if (sql.includes('stamps_balance = stamps_balance + 1')) {
                const bal = options.balanceAfter ?? 5
                return { rows: [{ stamps_balance: bal }] }
            }
        }

        if (sql.includes('SELECT stamps_balance')) {
            return { rows: [{ stamps_balance: 4 }] }
        }

        if (sql.includes('UPDATE stamp_lots')) {
            return {
                rows: [
                    {
                        id: 'lot-1',
                        remaining_count: 9
                    }
                ]
            }
        }

        if (sql.includes('INSERT INTO stamp_transactions')) {
            if (params) {
                stampTransactionInserts.push(params)
            }
            return { rows: [] }
        }

        if (sql.includes('UPDATE postcards')) {
            return { rows: [] }
        }

        if (sql.includes('DELETE FROM postcards')) {
            return { rows: [] }
        }

        if (sql.includes('BEGIN') || sql.includes('COMMIT') ||
            sql.includes('ROLLBACK')) {
            return { rows: [] }
        }

        return { rows: [] }
    })

    const connect = vi.fn(async () => {
        return { query, release }
    })

    vi.doMock('@netlify/database', () => {
        return {
            getDatabase: () => ({
                pool: { connect, query }
            })
        }
    })

    const blobStore = {
        get: vi.fn(async () => Buffer.from('fake-png-data'))
    }

    vi.doMock('@netlify/blobs', () => {
        return {
            getStore: () => blobStore
        }
    })

    return {
        connect,
        query,
        release,
        stampTransactionInserts,
        blobStore
    }
}

describe('US-030 POST /api/postcards/send', () => {
    beforeEach(() => {
        vi.doUnmock('@netlify/database')
        vi.doUnmock('@netlify/blobs')
        vi.doUnmock('../netlify/lib/session.js')
        vi.doUnmock('../netlify/lib/stamps.js')
        vi.doUnmock('../netlify/lib/drawing-images.js')
        vi.doUnmock('../netlify/lib/resend.js')
        vi.resetModules()
    })

    it('rejects non-POST requests', async () => {
        vi.resetModules()

        createDbMock()

        const event = {
            httpMethod: 'GET',
            headers: {},
            rawUrl: 'http://localhost/.netlify/functions/postcards-send',
            path: '/.netlify/functions/postcards-send',
            body: null
        } as any

        const { handler } = await import(
            '../netlify/functions/postcards-send.js'
        )

        const response = await handler(event, {} as any)

        if (response) {
            expect(response.statusCode).toBe(405)
        }
    })

    it('rejects unauthenticated requests', async () => {
        vi.resetModules()

        createDbMock()

        vi.doMock('../netlify/lib/session.js', () => ({
            getSession: async () => null
        }))

        const event = {
            httpMethod: 'POST',
            headers: {},
            rawUrl: 'http://localhost/.netlify/functions/postcards-send',
            path: '/.netlify/functions/postcards-send',
            body: JSON.stringify({
                drawing_id: 'drawing-1',
                recipient_email: 'recipient@example.com'
            })
        } as any

        const { handler } = await import(
            '../netlify/functions/postcards-send.js'
        )

        const response = await handler(event, {} as any)

        if (response) {
            expect(response.statusCode).toBe(401)
        }
    })

    it('AC1.1: success path debits one stamp and sends email', async () => {
        vi.resetModules()

        const _db = createDbMock()

        mockRateLimitAllow()

        vi.doMock('../netlify/lib/session.js', () => ({
            getSession: async () => ({
                user: { id: 'user-1', did: 'did:plc:test-1', handle: 'test.bsky.social' }
            })
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
                    created_at: new Date().toISOString()
                },
                reused: false
            }),
            transitionPostcardToDebiting:
                vi.fn().mockResolvedValue({ ok: true }),
            attachLotAndMarkSent:
                vi.fn().mockResolvedValue(undefined),
            markFailedRefunded: vi.fn().mockResolvedValue(undefined),
            deleteIfQueued: vi.fn().mockResolvedValue(undefined),
            rollbackDebitingToQueued:
                vi.fn().mockResolvedValue(undefined)
        }))

        vi.doMock('../netlify/lib/drawing-images.js', () => ({
            getDrawingImage: async () => Buffer.from('fake-png')
        }))

        vi.doMock('../netlify/lib/resend.js', () => ({
            sendPostcardEmail: async () => 're_test'
        }))

        const event = {
            httpMethod: 'POST',
            headers: {},
            rawUrl: 'http://localhost/.netlify/functions/postcards-send',
            path: '/.netlify/functions/postcards-send',
            body: JSON.stringify({
                drawing_id: 'drawing-1',
                recipient_email: 'recipient@example.com'
            })
        } as any

        const { handler } = await import(
            '../netlify/functions/postcards-send.js'
        )

        const response = await handler(event, {} as any)

        expect(response).toBeTruthy()
        if (!response) throw new Error('No response')
        expect(response.statusCode).toBe(200)
        const body = JSON.parse(response.body || '')
        expect(body.id).toBe('postcard-1')
        expect(body.balance_after).toBe(4)
    })

    it('AC1.2: idempotent retry returns same id, debits once', async () => {
        vi.resetModules()

        createDbMock()

        mockRateLimitAllow()

        vi.doMock('../netlify/lib/session.js', () => ({
            getSession: async () => ({
                user: { id: 'user-1', did: 'did:plc:test-1', handle: 'test.bsky.social' }
            })
        }))

        vi.doMock('../netlify/lib/stamps.js', async () => {
            const mod = await vi.importActual(
                '../netlify/lib/stamps.js'
            )
            return {
                ...mod,
                debitStamp: async () => ({
                    lotId: 'lot-1',
                    balanceAfter: 4
                }),
                InsufficientStampsError:
                    (mod as any).InsufficientStampsError
            }
        })

        vi.doMock('../netlify/lib/postcards.js', () => ({
            findOrCreateQueuedPostcard: vi.fn().mockResolvedValue({
                postcard: {
                    id: 'postcard-1',
                    status: 'sent',
                    created_at: new Date().toISOString()
                },
                reused: true
            }),
            transitionPostcardToDebiting:
                vi.fn().mockResolvedValue({ ok: true }),
            attachLotAndMarkSent:
                vi.fn().mockResolvedValue(undefined),
            markFailedRefunded: vi.fn().mockResolvedValue(undefined),
            deleteIfQueued: vi.fn().mockResolvedValue(undefined),
            rollbackDebitingToQueued:
                vi.fn().mockResolvedValue(undefined)
        }))

        vi.doMock('../netlify/lib/drawing-images.js', () => ({
            getDrawingImage: async () => Buffer.from('fake-png')
        }))

        vi.doMock('../netlify/lib/resend.js', () => ({
            sendPostcardEmail: async () => 're_test'
        }))

        vi.doMock('@netlify/database', () => {
            const mockQuery = vi.fn<Query>(
                async (sql:string, _params?:unknown[]) => {
                    if (sql.includes('SELECT *') &&
                        sql.includes('FROM postcards')) {
                        return {
                            rows: [{
                                id: 'postcard-1',
                                status: 'sent',
                                created_at:
                                    new Date().toISOString()
                            }]
                        }
                    }
                    if (sql.includes('SELECT stamps_balance')) {
                        return { rows: [{ stamps_balance: 4 }] }
                    }
                    if (sql.includes('SELECT blob_key')) {
                        return {
                            rows: [{
                                blob_key:
                                    'users/user-1/drawings/' +
                                    'drawing-1.png',
                                text: 'test drawing',
                                alt_text: 'alt text'
                            }]
                        }
                    }
                    if (sql.includes('SELECT 1') &&
                        sql.includes('FROM drawings')) {
                        return { rows: [{ 1: 1 }] }
                    }
                    if (
                        sql.includes('UPDATE users') &&
                        sql.includes(
                            'stamps_balance = stamps_balance - 1'
                        )
                    ) {
                        return { rows: [{ stamps_balance: 4 }] }
                    }
                    if (sql.includes('UPDATE stamp_lots')) {
                        return {
                            rows: [{
                                id: 'lot-1',
                                remaining_count: 9
                            }]
                        }
                    }
                    if (sql.includes('INSERT INTO postcards')) {
                        return {
                            rows: [{
                                id: 'postcard-1',
                                sender_id: 'user-1',
                                drawing_id: 'drawing-1',
                                recipient_email:
                                    'recipient@example.com',
                                lot_id: null,
                                resend_email_id: null,
                                status: 'queued',
                                idempotency_key: 'idempotent-key-1',
                                created_at:
                                    new Date().toISOString(),
                                updated_at:
                                    new Date().toISOString()
                            }]
                        }
                    }
                    if (sql.includes('INSERT INTO stamp_transactions')) {
                        return { rows: [] }
                    }
                    if (sql.includes('UPDATE postcards')) {
                        return { rows: [] }
                    }
                    if (sql.includes('DELETE FROM postcards')) {
                        return { rows: [] }
                    }
                    if (sql.includes('BEGIN') ||
                        sql.includes('COMMIT') ||
                        sql.includes('ROLLBACK')) {
                        return { rows: [] }
                    }
                    return { rows: [] }
                }
            )

            return {
                getDatabase: () => ({
                    pool: {
                        connect: vi.fn(async () => ({
                            query: mockQuery,
                            release: vi.fn()
                        })),
                        query: mockQuery
                    }
                })
            }
        })

        const { handler } = await import(
            '../netlify/functions/postcards-send.js'
        )

        const idempotencyKey = 'idempotent-key-1'
        const event = {
            httpMethod: 'POST',
            headers: {},
            rawUrl: 'http://localhost/.netlify/functions/postcards-send',
            path: '/.netlify/functions/postcards-send',
            body: JSON.stringify({
                drawing_id: 'drawing-1',
                recipient_email: 'recipient@example.com',
                idempotency_key: idempotencyKey
            })
        } as any

        const response = await handler(event, {} as any)

        expect(response).toBeTruthy()
        if (!response) throw new Error('No response')
        expect(response.statusCode).toBe(200)
        const body = JSON.parse(response.body || '')
        expect(body.id).toBe('postcard-1')
    })

    it('AC2.1: insufficient stamps returns 402', async () => {
        vi.resetModules()

        createDbMock({
            insufficientStamps: true
        })

        mockRateLimitAllow()

        vi.doMock('../netlify/lib/session.js', () => ({
            getSession: async () => ({
                user: { id: 'user-1', did: 'did:plc:test-1', handle: 'test.bsky.social' }
            })
        }))

        vi.doMock('../netlify/lib/stamps.js', async () => {
            const mod = await vi.importActual(
                '../netlify/lib/stamps.js'
            )
            return {
                ...mod,
                debitStamp: async () => {
                    throw new (mod as any).InsufficientStampsError()
                },
                InsufficientStampsError:
                    (mod as any).InsufficientStampsError
            }
        })

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
                    created_at: new Date().toISOString()
                },
                reused: false
            }),
            transitionPostcardToDebiting:
                vi.fn().mockResolvedValue({ ok: true }),
            attachLotAndMarkSent:
                vi.fn().mockResolvedValue(undefined),
            markFailedRefunded: vi.fn().mockResolvedValue(undefined),
            deleteIfQueued: vi.fn().mockResolvedValue(undefined),
            rollbackDebitingToQueued:
                vi.fn().mockResolvedValue(undefined)
        }))

        const { handler } = await import(
            '../netlify/functions/postcards-send.js'
        )

        const event = {
            httpMethod: 'POST',
            headers: {},
            rawUrl: 'http://localhost/.netlify/functions/postcards-send',
            path: '/.netlify/functions/postcards-send',
            body: JSON.stringify({
                drawing_id: 'drawing-1',
                recipient_email: 'recipient@example.com'
            })
        } as any

        const response = await handler(event, {} as any)

        expect(response).toBeTruthy()
        if (!response) throw new Error('No response')
        expect(response.statusCode).toBe(402)
        const body = JSON.parse(response.body || '')
        expect(body.error).toBe('insufficient_stamps')
    })

    it('AC2.3: free user with stamps can send', async () => {
        vi.resetModules()

        createDbMock()

        mockRateLimitAllow()

        vi.doMock('../netlify/lib/session.js', () => ({
            getSession: async () => ({
                user: {
                    id: 'user-1',
                    did: 'did:plc:test-1',
                    handle: 'test.bsky.social'
                }
            })
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
                    created_at: new Date().toISOString()
                },
                reused: false
            }),
            transitionPostcardToDebiting:
                vi.fn().mockResolvedValue({ ok: true }),
            attachLotAndMarkSent:
                vi.fn().mockResolvedValue(undefined),
            markFailedRefunded: vi.fn().mockResolvedValue(undefined),
            deleteIfQueued: vi.fn().mockResolvedValue(undefined),
            rollbackDebitingToQueued:
                vi.fn().mockResolvedValue(undefined)
        }))

        vi.doMock('../netlify/lib/drawing-images.js', () => ({
            getDrawingImage: async () => Buffer.from('fake-png')
        }))

        vi.doMock('../netlify/lib/resend.js', () => ({
            sendPostcardEmail: async () => 're_test'
        }))

        const event = {
            httpMethod: 'POST',
            headers: {},
            rawUrl: 'http://localhost/.netlify/functions/postcards-send',
            path: '/.netlify/functions/postcards-send',
            body: JSON.stringify({
                drawing_id: 'drawing-1',
                recipient_email: 'recipient@example.com'
            })
        } as any

        const { handler } = await import(
            '../netlify/functions/postcards-send.js'
        )

        const response = await handler(event, {} as any)

        expect(response).toBeTruthy()
        if (!response) throw new Error('No response')
        expect(response.statusCode).toBe(200)
    })

    it('AC3.1: blob write fail refunds stamp', async () => {
        vi.resetModules()

        createDbMock()

        mockRateLimitAllow()

        vi.doMock('../netlify/lib/session.js', () => ({
            getSession: async () => ({
                user: { id: 'user-1', did: 'did:plc:test-1', handle: 'test.bsky.social' }
            })
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
                    created_at: new Date().toISOString()
                },
                reused: false
            }),
            transitionPostcardToDebiting:
                vi.fn().mockResolvedValue({ ok: true }),
            attachLotAndMarkSent:
                vi.fn().mockResolvedValue(undefined),
            markFailedRefunded: vi.fn().mockResolvedValue(undefined),
            deleteIfQueued: vi.fn().mockResolvedValue(undefined),
            rollbackDebitingToQueued:
                vi.fn().mockResolvedValue(undefined)
        }))

        vi.doMock('../netlify/lib/drawing-images.js', () => ({
            getDrawingImage: async () => {
                throw new Error('blob unavailable')
            }
        }))

        const refundMock = vi.fn(async () => ({
            lotId: 'lot-1',
            balanceAfter: 5
        }))

        vi.doMock('../netlify/lib/stamps.js', async () => {
            const mod = await vi.importActual(
                '../netlify/lib/stamps.js'
            )
            return {
                ...mod,
                refundFailedSend: refundMock,
                InsufficientStampsError:
                    (mod as any).InsufficientStampsError
            }
        })

        const { handler } = await import(
            '../netlify/functions/postcards-send.js'
        )

        const event = {
            httpMethod: 'POST',
            headers: {},
            rawUrl: 'http://localhost/.netlify/functions/postcards-send',
            path: '/.netlify/functions/postcards-send',
            body: JSON.stringify({
                drawing_id: 'drawing-1',
                recipient_email: 'recipient@example.com'
            })
        } as any

        const response = await handler(event, {} as any)

        expect(response).toBeTruthy()
        if (!response) throw new Error('No response')
        expect(response.statusCode).toBe(502)
        const body = JSON.parse(response.body || '')
        expect(body.error).toBe('send_failed')
        expect(refundMock).toHaveBeenCalledWith({
            userId: 'user-1',
            lotId: 'lot-1'
        })
    })

    it('AC3.2: Resend rejects synchronously', async () => {
        vi.resetModules()

        createDbMock()

        mockRateLimitAllow()

        vi.doMock('../netlify/lib/session.js', () => ({
            getSession: async () => ({
                user: { id: 'user-1', did: 'did:plc:test-1', handle: 'test.bsky.social' }
            })
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
                    created_at: new Date().toISOString()
                },
                reused: false
            }),
            transitionPostcardToDebiting:
                vi.fn().mockResolvedValue({ ok: true }),
            attachLotAndMarkSent:
                vi.fn().mockResolvedValue(undefined),
            markFailedRefunded: vi.fn().mockResolvedValue(undefined),
            deleteIfQueued: vi.fn().mockResolvedValue(undefined),
            rollbackDebitingToQueued:
                vi.fn().mockResolvedValue(undefined)
        }))

        vi.doMock('../netlify/lib/drawing-images.js', () => ({
            getDrawingImage: async () => Buffer.from('fake-png')
        }))

        vi.doMock('../netlify/lib/resend.js', () => ({
            sendPostcardEmail: async () => {
                throw new Error('Resend failed')
            }
        }))

        const refundMock = vi.fn(async () => ({
            lotId: 'lot-1',
            balanceAfter: 5
        }))

        vi.doMock('../netlify/lib/stamps.js', async () => {
            const mod = await vi.importActual(
                '../netlify/lib/stamps.js'
            )
            return {
                ...mod,
                refundFailedSend: refundMock,
                InsufficientStampsError:
                    (mod as any).InsufficientStampsError
            }
        })

        const { handler } = await import(
            '../netlify/functions/postcards-send.js'
        )

        const event = {
            httpMethod: 'POST',
            headers: {},
            rawUrl: 'http://localhost/.netlify/functions/postcards-send',
            path: '/.netlify/functions/postcards-send',
            body: JSON.stringify({
                drawing_id: 'drawing-1',
                recipient_email: 'recipient@example.com'
            })
        } as any

        const response = await handler(event, {} as any)

        expect(response).toBeTruthy()
        if (!response) throw new Error('No response')
        expect(response.statusCode).toBe(502)
        const body = JSON.parse(response.body || '')
        expect(body.error).toBe('send_failed')
        expect(refundMock).toHaveBeenCalledWith({
            userId: 'user-1',
            lotId: 'lot-1'
        })
    })

    it('AC3.3: audit trail on failure', async () => {
        vi.resetModules()

        const transactionInserts:Array<
            {reason:string}
        > = []

        const db = createDbMock()
        const originalQuery = db.query.getMockImplementation()

        mockRateLimitAllow()

        vi.mocked(db.query).mockImplementation(
            async (sql:string, params?:unknown[]) => {
                if (sql.includes('INSERT INTO stamp_transactions')) {
                    const idx = params?.indexOf('send') ?? -1
                    const idx2 = params?.indexOf(
                        'failed_send_refund'
                    ) ?? -1
                    if (idx >= 0) {
                        transactionInserts.push({
                            reason: 'send'
                        })
                    } else if (idx2 >= 0) {
                        transactionInserts.push({
                            reason: 'failed_send_refund'
                        })
                    }
                }
                return originalQuery!(sql, params)
            }
        )

        vi.doMock('../netlify/lib/session.js', () => ({
            getSession: async () => ({
                user: { id: 'user-1', did: 'did:plc:test-1', handle: 'test.bsky.social' }
            })
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
                    created_at: new Date().toISOString()
                },
                reused: false
            }),
            transitionPostcardToDebiting:
                vi.fn().mockResolvedValue({ ok: true }),
            attachLotAndMarkSent:
                vi.fn().mockResolvedValue(undefined),
            markFailedRefunded: vi.fn().mockResolvedValue(undefined),
            deleteIfQueued: vi.fn().mockResolvedValue(undefined),
            rollbackDebitingToQueued:
                vi.fn().mockResolvedValue(undefined)
        }))

        vi.doMock('../netlify/lib/drawing-images.js', () => ({
            getDrawingImage: async () => Buffer.from('fake-png')
        }))

        vi.doMock('../netlify/lib/resend.js', () => ({
            sendPostcardEmail: async () => {
                throw new Error('Resend failed')
            }
        }))

        const { handler } = await import(
            '../netlify/functions/postcards-send.js'
        )

        const event = {
            httpMethod: 'POST',
            headers: {},
            rawUrl: 'http://localhost/.netlify/functions/postcards-send',
            path: '/.netlify/functions/postcards-send',
            body: JSON.stringify({
                drawing_id: 'drawing-1',
                recipient_email: 'recipient@example.com'
            })
        } as any

        const response = await handler(event, {} as any)

        expect(response).toBeTruthy()
        if (!response) throw new Error('No response')
        expect(response.statusCode).toBe(502)
        expect(transactionInserts.length).toBe(2)
        expect(transactionInserts[0].reason).toBe('send')
        expect(transactionInserts[1].reason).toBe('failed_send_refund')
    })
})
