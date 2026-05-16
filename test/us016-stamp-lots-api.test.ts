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

const lotsEvent:HandlerEvent = {
    rawUrl: 'https://drerings.app/api/stamps/lots',
    rawQuery: '',
    path: '/api/stamps/lots',
    httpMethod: 'GET',
    headers: {
        host: 'drerings.app'
    },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false
}

describe('US-016 stamp lots API', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('returns caller stamp lots with refund previews', async () => {
        vi.resetModules()

        const db = mockDatabase()

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: async () => activeSession() }
        })

        const { handler } = await import('../netlify/functions/stamps/lots')
        const response = await callHandler(handler, lotsEvent)

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            lots: [
                {
                    id: 'lot-purchase',
                    source: 'purchase',
                    original_count: 25,
                    remaining_count: 15,
                    refund_cents: 600,
                    created_at: '2026-05-01T00:00:00.000Z'
                },
                {
                    id: 'lot-grant',
                    source: 'grant',
                    original_count: 10,
                    remaining_count: 10,
                    refund_cents: 0,
                    created_at: '2026-05-02T00:00:00.000Z'
                }
            ],
            pending_gifts: []
        })
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('FROM stamp_lots'),
            ['user-1']
        )
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('ORDER BY created_at DESC'),
            ['user-1']
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

function mockDatabase () {
    const query = vi.fn<Query>(async (sql) => {
        if (sql.includes('FROM pending_gifts')) {
            return { rows: [] }
        }

        return {
            rows: [
                {
                    id: 'lot-purchase',
                    source: 'purchase',
                    original_count: 25,
                    remaining_count: 15,
                    price_paid_cents: 1000,
                    created_at: '2026-05-01T00:00:00.000Z'
                },
                {
                    id: 'lot-grant',
                    source: 'grant',
                    original_count: 10,
                    remaining_count: 10,
                    price_paid_cents: null,
                    created_at: '2026-05-02T00:00:00.000Z'
                }
            ]
        }
    })

    vi.doMock('@netlify/database', () => {
        return {
            getDatabase: () => ({
                pool: { query }
            })
        }
    })

    return { query }
}

function activeSession () {
    return {
        user: {
            id: 'user-1',
            email: 'paid@example.com',
            subscription_status: 'active',
            stamps_balance: 25
        }
    }
}
