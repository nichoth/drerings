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

const refundEvent:HandlerEvent = {
    rawUrl: 'https://drerings.app/api/stamps/refund/lot-1',
    rawQuery: '',
    path: '/api/stamps/refund/lot-1',
    httpMethod: 'POST',
    headers: {
        host: 'drerings.app'
    },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false
}

async function callHandler (
    handler:Handler,
    event:HandlerEvent
):Promise<HandlerResponse> {
    const response = await handler(event, context)

    if (!response) throw new Error('Handler did not return a response')

    return response
}

function mockActiveSession () {
    vi.doMock('../netlify/lib/session', () => {
        return {
            getSession: async () => ({
                user: {
                    id: 'user-1',
                    email: 'paid@example.com',
                    subscription_status: 'active',
                    stamps_balance: 15
                }
            })
        }
    })
}

function mockRefundDatabase (
    overrides:Record<string, unknown> = {}
) {
    const release = vi.fn()
    const query = vi.fn<Query>(async (sql) => {
        if (
            sql.includes('SELECT') &&
            sql.includes('FROM stamp_lots')
        ) {
            return {
                rows: [{
                    id: 'lot-1',
                    source: 'purchase',
                    original_count: 25,
                    remaining_count: 15,
                    price_paid_cents: 1000,
                    autumn_checkout_id: 'checkout-1',
                    ...overrides
                }]
            }
        }

        if (sql.includes('UPDATE users')) {
            return { rows: [{ stamps_balance: 10 }] }
        }

        return { rows: [] }
    })
    const connect = vi.fn(async () => {
        return { query, release }
    })

    vi.doMock('@netlify/database', () => {
        return {
            getDatabase: () => ({
                pool: { connect }
            })
        }
    })

    return { connect, query, release }
}

describe('US-015 stamp refund API', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('refunds unused purchase stamps from a caller-owned lot', async () => {
        vi.resetModules()
        vi.stubEnv('AUTUMN_SECRET_KEY', 'autumn-sk-test')
        vi.stubEnv('AUTUMN_API_URL', 'https://api.useautumn.test')

        const db = mockRefundDatabase()
        const fetcher = vi.fn(async () => {
            return new Response(JSON.stringify({ id: 'refund-1' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        })

        mockActiveSession()
        vi.stubGlobal('fetch', fetcher)

        const { handler } = await import(
            '../netlify/functions/stamps/refund'
        )
        const response = await callHandler(handler, refundEvent)

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            refund_cents: 600,
            stamps_balance: 10
        })
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('FOR UPDATE'),
            ['lot-1', 'user-1']
        )
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('remaining_count = 0'),
            ['lot-1', 'user-1']
        )
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('stamps_balance = stamps_balance - $1'),
            [15, 'user-1']
        )
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO stamp_transactions'),
            ['user-1', 'lot-1', -15, 'refund', 'checkout-1', 10]
        )
        expect(fetcher).toHaveBeenCalledWith(
            'https://api.useautumn.test/refunds',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    authorization: 'Bearer autumn-sk-test',
                    'content-type': 'application/json'
                }),
                body: JSON.stringify({
                    checkout_id: 'checkout-1',
                    amount_cents: 600
                })
            })
        )
        expect(db.query).toHaveBeenCalledWith('COMMIT')
        expect(db.release).toHaveBeenCalled()
    })

    it('rejects non-purchase stamp lots before calling Autumn', async () => {
        vi.resetModules()

        const db = mockRefundDatabase({
            source: 'grant',
            price_paid_cents: null,
            autumn_checkout_id: null
        })
        const fetcher = vi.fn()

        mockActiveSession()
        vi.stubGlobal('fetch', fetcher)

        const { handler } = await import(
            '../netlify/functions/stamps/refund'
        )
        const response = await callHandler(handler, refundEvent)

        expect(response.statusCode).toBe(400)
        expect(JSON.parse(response.body || '{}').error)
            .toMatch(/not refundable/i)
        expect(fetcher).not.toHaveBeenCalled()
        expect(db.query).toHaveBeenCalledWith('ROLLBACK')
        expect(db.release).toHaveBeenCalled()
    })

    it('rolls back local refund writes when Autumn fails', async () => {
        vi.resetModules()
        vi.stubEnv('AUTUMN_SECRET_KEY', 'autumn-sk-test')

        const errorSpy = vi.spyOn(console, 'error')
            .mockImplementation(() => undefined)
        const db = mockRefundDatabase()
        const fetcher = vi.fn(async () => {
            return new Response(JSON.stringify({ error: 'nope' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            })
        })

        mockActiveSession()
        vi.stubGlobal('fetch', fetcher)

        const { handler } = await import(
            '../netlify/functions/stamps/refund'
        )
        const response = await callHandler(handler, refundEvent)

        expect(response.statusCode).toBe(502)
        expect(JSON.parse(response.body || '{}').error)
            .toMatch(/unable to refund/i)
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('remaining_count = 0'),
            ['lot-1', 'user-1']
        )
        expect(db.query).toHaveBeenCalledWith('ROLLBACK')
        expect(db.query).not.toHaveBeenCalledWith('COMMIT')
        expect(db.release).toHaveBeenCalled()
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('check Autumn'),
            expect.any(Error)
        )
    })
})
