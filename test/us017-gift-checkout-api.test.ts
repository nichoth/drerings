import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'

type Query = (
    sql:string,
    params?:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

const context = {} as HandlerContext

describe('US-017 gift checkout API', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('creates a stamp checkout for an existing gift recipient',
        async () => {
            vi.resetModules()
            vi.stubEnv('AUTUMN_SECRET_KEY', 'autumn-sk-test')
            vi.stubEnv('AUTUMN_API_URL', 'https://api.useautumn.test')

            const query = vi.fn<Query>(async (sql) => {
                if (
                    sql.includes('FROM users') &&
                    sql.includes('lower(handle)')
                ) {
                    return {
                        rows: [{
                            id: 'recipient-1',
                            handle: 'alice.bsky.social',
                            did: 'did:plc:recipient1234567890123456789'
                        }]
                    }
                }

                return { rows: [] }
            })
            const fetcher = vi.fn(async () => {
                return new Response(JSON.stringify({
                    url: 'https://checkout.stripe.com/pay/gift-1',
                    customer_id: 'autumn-sender-1'
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            })

            vi.stubGlobal('fetch', fetcher)
            vi.doMock('@netlify/database', () => {
                return {
                    getDatabase: () => ({
                        pool: { query }
                    })
                }
            })
            vi.doMock('../netlify/lib/session', () => {
                return { getSession: async () => ({ user: sender() }) }
            })

            vi.doMock('../netlify/lib/rate-limit.js', () => ({
                checkAndIncrement: vi.fn().mockResolvedValue({
                    allowed: true,
                    remaining: 4,
                    resetAt: new Date(Date.now() + 60 * 1000)
                }),
                getClientIp: vi.fn(),
                rateLimitResponse: vi.fn()
            }))

            const { handler } = await import(
                '../netlify/functions/stamps-gifts-checkout'
            )
            const response = await callHandler(handler, event({
                product_id: '25_stamps',
                recipient: ' Alice.BSKY.Social '
            }))

            expect(response.statusCode).toBe(200)
            expect(JSON.parse(response.body || '{}')).toEqual({
                url: 'https://checkout.stripe.com/pay/gift-1',
                recipient: {
                    id: 'recipient-1',
                    handle: 'alice.bsky.social',
                    did: 'did:plc:recipient1234567890123456789'
                }
            })
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('lower(handle) = $1'),
                ['alice.bsky.social']
            )
            expect(fetcher).toHaveBeenCalledWith(
                'https://api.useautumn.test/checkout',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({
                        customer_id: 'sender-1',
                        product_id: '25_stamps',
                        success_url:
                            'https://drerings.app/account?status=ok',
                        customer_data: {
                            email: 'sender.bsky.social@bsky.social'
                        },
                        metadata: {
                            gift_sender_user_id: 'sender-1',
                            gift_sender_handle:
                                'sender.bsky.social',
                            gift_recipient_user_id: 'recipient-1',
                            gift_recipient_handle: 'alice.bsky.social'
                        },
                        checkout_session_params: {
                            cancel_url:
                                'https://drerings.app/account?status=cancel'
                        }
                    })
                })
            )
        })

    it('creates a pending checkout for email recipient not in system',
        async () => {
            vi.resetModules()
            vi.stubEnv('AUTUMN_SECRET_KEY', 'autumn-sk-test')
            vi.stubEnv('AUTUMN_API_URL', 'https://api.useautumn.test')

            const query = vi.fn<Query>(async () => ({ rows: [] }))
            const fetcher = vi.fn(async () => {
                return new Response(JSON.stringify({
                    url: 'https://checkout.stripe.com/pay/gift-pending',
                    customer_id: 'autumn-sender-1'
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            })

            vi.stubGlobal('fetch', fetcher)
            vi.doMock('@netlify/database', () => {
                return {
                    getDatabase: () => ({
                        pool: { query }
                    })
                }
            })
            vi.doMock('../netlify/lib/session', () => {
                return { getSession: async () => ({ user: sender() }) }
            })

            vi.doMock('../netlify/lib/rate-limit.js', () => ({
                checkAndIncrement: vi.fn().mockResolvedValue({
                    allowed: true,
                    remaining: 4,
                    resetAt: new Date(Date.now() + 60 * 1000)
                }),
                getClientIp: vi.fn(),
                rateLimitResponse: vi.fn()
            }))

            const { handler } = await import(
                '../netlify/functions/stamps-gifts-checkout'
            )
            const response = await callHandler(handler, event({
                product_id: '10_stamps',
                recipient: ' friend@example.com '
            }))

            expect(response.statusCode).toBe(200)
            expect(JSON.parse(response.body || '{}')).toEqual({
                url: 'https://checkout.stripe.com/pay/gift-pending',
                recipient: { email: 'friend@example.com', pending: true }
            })
            expect(fetcher).toHaveBeenCalledWith(
                'https://api.useautumn.test/checkout',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({
                        customer_id: 'sender-1',
                        product_id: '10_stamps',
                        success_url:
                            'https://drerings.app/account?status=ok',
                        customer_data: {
                            email: 'sender.bsky.social@bsky.social'
                        },
                        metadata: {
                            gift_sender_user_id: 'sender-1',
                            gift_sender_handle: 'sender.bsky.social',
                            gift_pending_recipient_email: 'friend@example.com'
                        },
                        checkout_session_params: {
                            cancel_url:
                                'https://drerings.app/account?status=cancel'
                        }
                    })
                })
            )
        })

    it('rejects gift checkout when handle does not exist',
        async () => {
            vi.resetModules()

            const query = vi.fn<Query>(async () => ({ rows: [] }))
            const fetcher = vi.fn()

            vi.stubGlobal('fetch', fetcher)
            vi.doMock('@netlify/database', () => {
                return {
                    getDatabase: () => ({
                        pool: { query }
                    })
                }
            })
            vi.doMock('../netlify/lib/session', () => {
                return { getSession: async () => ({ user: sender() }) }
            })

            vi.doMock('../netlify/lib/rate-limit.js', () => ({
                checkAndIncrement: vi.fn().mockResolvedValue({
                    allowed: true,
                    remaining: 4,
                    resetAt: new Date(Date.now() + 60 * 1000)
                }),
                getClientIp: vi.fn(),
                rateLimitResponse: vi.fn()
            }))

            const { handler } = await import(
                '../netlify/functions/stamps-gifts-checkout'
            )
            const response = await callHandler(handler, event({
                product_id: '25_stamps',
                recipient: 'unknown.bsky.social'
            }))

            expect(response.statusCode).toBe(404)
            expect(JSON.parse(response.body || '{}').error)
                .toMatch(/recipient.*not found/i)
            expect(fetcher).not.toHaveBeenCalled()
        })

    it('rejects gift checkout for self-gift',
        async () => {
            vi.resetModules()

            const query = vi.fn<Query>(async (sql) => {
                if (sql.includes('FROM users') && sql.includes('lower(handle)')) {
                    return {
                        rows: [{
                            id: 'sender-1',
                            handle: 'sender.bsky.social',
                            did: 'did:plc:sender1234567890123456789'
                        }]
                    }
                }

                return { rows: [] }
            })
            const fetcher = vi.fn()

            vi.stubGlobal('fetch', fetcher)
            vi.doMock('@netlify/database', () => {
                return {
                    getDatabase: () => ({
                        pool: { query }
                    })
                }
            })
            vi.doMock('../netlify/lib/session', () => {
                return { getSession: async () => ({ user: sender() }) }
            })

            vi.doMock('../netlify/lib/rate-limit.js', () => ({
                checkAndIncrement: vi.fn().mockResolvedValue({
                    allowed: true,
                    remaining: 4,
                    resetAt: new Date(Date.now() + 60 * 1000)
                }),
                getClientIp: vi.fn(),
                rateLimitResponse: vi.fn()
            }))

            const { handler } = await import(
                '../netlify/functions/stamps-gifts-checkout'
            )
            const response = await callHandler(handler, event({
                product_id: '25_stamps',
                recipient: 'sender.bsky.social'
            }))

            expect(response.statusCode).toBe(404)
            expect(JSON.parse(response.body || '{}').error)
                .toMatch(/recipient.*not found/i)
            expect(fetcher).not.toHaveBeenCalled()
        })

    it('preserves DID case when passed to lookupGiftRecipient',
        async () => {
            vi.resetModules()
            vi.stubEnv('AUTUMN_SECRET_KEY', 'autumn-sk-test')
            vi.stubEnv('AUTUMN_API_URL', 'https://api.useautumn.test')

            const query = vi.fn<Query>(async (sql) => {
                if (
                    sql.includes('FROM users') &&
                    sql.includes('WHERE did = $1')
                ) {
                    return {
                        rows: [{
                            id: 'recipient-1',
                            handle: 'alice.bsky.social',
                            did: 'did:plc:aBc1234567890123456789xYz'
                        }]
                    }
                }

                return { rows: [] }
            })
            const fetcher = vi.fn(async () => {
                return new Response(JSON.stringify({
                    url: 'https://checkout.stripe.com/pay/gift-1',
                    customer_id: 'autumn-sender-1'
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            })

            vi.stubGlobal('fetch', fetcher)
            vi.doMock('@netlify/database', () => {
                return {
                    getDatabase: () => ({
                        pool: { query }
                    })
                }
            })
            vi.doMock('../netlify/lib/session', () => {
                return { getSession: async () => ({ user: sender() }) }
            })

            vi.doMock('../netlify/lib/rate-limit.js', () => ({
                checkAndIncrement: vi.fn().mockResolvedValue({
                    allowed: true,
                    remaining: 4,
                    resetAt: new Date(Date.now() + 60 * 1000)
                }),
                getClientIp: vi.fn(),
                rateLimitResponse: vi.fn()
            }))

            const { handler } = await import(
                '../netlify/functions/stamps-gifts-checkout'
            )
            const response = await callHandler(handler, event({
                product_id: '25_stamps',
                recipient: ' did:plc:aBc1234567890123456789xYz '
            }))

            expect(response.statusCode).toBe(200)
            expect(JSON.parse(response.body || '{}')).toEqual({
                url: 'https://checkout.stripe.com/pay/gift-1',
                recipient: {
                    id: 'recipient-1',
                    handle: 'alice.bsky.social',
                    did: 'did:plc:aBc1234567890123456789xYz'
                }
            })
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE did = $1'),
                ['did:plc:aBc1234567890123456789xYz']
            )
        })
})

async function callHandler (
    handler:Handler,
    event:HandlerEvent
):Promise<HandlerResponse> {
    const response = await handler(event, context)

    if (!response) throw new Error('Handler did not return a response')

    return response
}

function event (body:Record<string, unknown>):HandlerEvent {
    return {
        rawUrl: 'https://drerings.app/api/stamps/gifts/checkout',
        rawQuery: '',
        path: '/api/stamps/gifts/checkout',
        httpMethod: 'POST',
        headers: { host: 'drerings.app' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        body: JSON.stringify(body),
        isBase64Encoded: false
    }
}

function sender () {
    return {
        id: 'sender-1',
        did: 'did:plc:sender1234567890123456789',
        handle: 'sender.bsky.social',
        stamps_balance: 12
    }
}
