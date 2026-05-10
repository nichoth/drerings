import { describe, expect, it, vi } from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'

const baseEvent:HandlerEvent = {
    rawUrl: 'https://drerings.app/api/billing/checkout',
    rawQuery: '',
    path: '/api/billing/checkout',
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

const context = {} as HandlerContext

async function callHandler (
    handler:Handler,
    event:HandlerEvent
):Promise<HandlerResponse> {
    const response = await handler(event, context)

    if (!response) throw new Error('Handler did not return a response')

    return response
}

describe('US-014 billing checkout API', () => {
    it('creates a checkout session for the current user', async () => {
        vi.resetModules()

        const session = {
            user: {
                id: 'user-1',
                email: 'free@example.com',
                subscription_status: 'free'
            }
        }
        const createCheckoutSession = vi.fn(async () => {
            return {
                url: 'https://checkout.stripe.com/pay/cs_test_123',
                customer_id: 'autumn-user-1'
            }
        })

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: async () => session }
        })
        vi.doMock('../netlify/lib/billing', () => {
            return { createCheckoutSession }
        })

        const { handler } = await import(
            '../netlify/functions/billing/checkout'
        )
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            url: 'https://checkout.stripe.com/pay/cs_test_123'
        })
        expect(createCheckoutSession).toHaveBeenCalledWith(
            session.user,
            'https://drerings.app'
        )
    })

    it('returns unauthorized before creating a checkout', async () => {
        vi.resetModules()

        const createCheckoutSession = vi.fn()

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: async () => null }
        })
        vi.doMock('../netlify/lib/billing', () => {
            return { createCheckoutSession }
        })

        const { handler } = await import(
            '../netlify/functions/billing/checkout'
        )
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(401)
        expect(JSON.parse(response.body || '{}').error).toMatch(/sign in/i)
        expect(createCheckoutSession).not.toHaveBeenCalled()
    })

    it('rejects methods other than POST', async () => {
        vi.resetModules()

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: async () => null }
        })
        vi.doMock('../netlify/lib/billing', () => {
            return { createCheckoutSession: vi.fn() }
        })

        const { handler } = await import(
            '../netlify/functions/billing/checkout'
        )
        const response = await callHandler(handler, {
            ...baseEvent,
            httpMethod: 'GET'
        })

        expect(response.statusCode).toBe(405)
    })
})
