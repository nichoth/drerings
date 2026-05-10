import { describe, expect, it, vi } from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'

type Query = (
    sql:string,
    params:unknown[]
) => Promise<{ rows:Array<Record<string, unknown>> }>

const context = {} as HandlerContext

async function callHandler (
    handler:Handler,
    event:HandlerEvent
):Promise<HandlerResponse> {
    const response = await handler(event, context)

    if (!response) throw new Error('Handler did not return a response')

    return response
}

describe('US-017 billing cancel', () => {
    it('cancels Autumn at period end and stores the end date', async () => {
        vi.resetModules()
        vi.stubEnv('AUTUMN_SECRET_KEY', 'autumn-secret')
        vi.stubEnv('AUTUMN_API_URL', 'https://api.useautumn.test')

        const query = vi.fn<Query>(async () => ({ rows: [] }))
        const fetcher = vi.fn(async () => {
            return new Response(JSON.stringify({
                current_period_end: '2026-06-01'
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

        const { cancelAutumnSubscription } = await import(
            '../netlify/lib/billing'
        )
        const result = await cancelAutumnSubscription({
            id: 'user-1',
            email: 'paid@example.com',
            subscription_status: 'active',
            autumn_customer_id: 'autumn-user-1'
        })

        expect(fetcher).toHaveBeenCalledWith(
            'https://api.useautumn.test/customers/autumn-user-1/cancel',
            expect.objectContaining({ method: 'POST' })
        )
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('subscription_current_period_end'),
            ['canceled', '2026-06-01', 'user-1']
        )
        expect(result?.subscription_current_period_end).toBe('2026-06-01')
    })

    it('exposes POST /api/billing/cancel for active sessions', async () => {
        vi.resetModules()

        const cancelAutumnSubscription = vi.fn(async () => {
            return {
                subscription_status: 'canceled',
                subscription_current_period_end: '2026-06-01'
            }
        })

        vi.doMock('../netlify/lib/session', () => {
            return {
                getSession: async () => ({
                    user: {
                        id: 'user-1',
                        email: 'paid@example.com',
                        subscription_status: 'active'
                    }
                })
            }
        })
        vi.doMock('../netlify/lib/billing', () => {
            return { cancelAutumnSubscription }
        })

        const { handler } = await import(
            '../netlify/functions/billing/cancel'
        )
        const response = await callHandler(handler, billingEvent())

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            subscription_status: 'canceled',
            subscription_current_period_end: '2026-06-01'
        })
    })
})

function billingEvent ():HandlerEvent {
    return {
        rawUrl: 'https://drerings.app/api/billing/cancel',
        rawQuery: '',
        path: '/api/billing/cancel',
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
}
