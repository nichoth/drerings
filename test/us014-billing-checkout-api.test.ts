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
    it('creates a checkout session for the submitted email', async () => {
        vi.resetModules()

        const upsertCheckoutUser = vi.fn(async () => ({
            id: 'user-1',
            email: 'buyer@example.com',
            subscription_status: 'free',
            autumn_customer_id: null
        }))
        const createCheckoutSession = vi.fn(async () => {
            return {
                url: 'https://checkout.stripe.com/pay/cs_test_123',
                customer_id: 'autumn-user-1'
            }
        })

        vi.doMock('../netlify/lib/auth-store', () => {
            return { upsertCheckoutUser }
        })
        vi.doMock('../netlify/lib/billing', () => {
            return { createCheckoutSession }
        })

        const { handler } = await import(
            '../netlify/functions/billing/checkout'
        )
        const response = await callHandler(handler, {
            ...baseEvent,
            body: JSON.stringify({ email: ' Buyer@Example.COM ' })
        })

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            url: 'https://checkout.stripe.com/pay/cs_test_123'
        })
        expect(upsertCheckoutUser).toHaveBeenCalledWith('buyer@example.com')
        expect(createCheckoutSession).toHaveBeenCalledWith(
            {
                id: 'user-1',
                email: 'buyer@example.com',
                subscription_status: 'free',
                autumn_customer_id: null
            },
            'https://drerings.app'
        )
    })

    it('rejects requests with no email', async () => {
        vi.resetModules()

        const upsertCheckoutUser = vi.fn()
        const createCheckoutSession = vi.fn()

        vi.doMock('../netlify/lib/auth-store', () => {
            return { upsertCheckoutUser }
        })
        vi.doMock('../netlify/lib/billing', () => {
            return { createCheckoutSession }
        })

        const { handler } = await import(
            '../netlify/functions/billing/checkout'
        )
        const response = await callHandler(handler, {
            ...baseEvent,
            body: JSON.stringify({})
        })

        expect(response.statusCode).toBe(400)
        expect(JSON.parse(response.body || '{}').error).toMatch(/email/i)
        expect(upsertCheckoutUser).not.toHaveBeenCalled()
        expect(createCheckoutSession).not.toHaveBeenCalled()
    })

    it('rejects methods other than POST', async () => {
        vi.resetModules()

        vi.doMock('../netlify/lib/auth-store', () => {
            return { upsertCheckoutUser: vi.fn() }
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
