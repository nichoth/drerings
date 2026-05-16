import { describe, expect, it, vi } from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'

const baseEvent:HandlerEvent = {
    rawUrl: 'https://drerings.app/api/posts',
    rawQuery: '',
    path: '/api/posts',
    httpMethod: 'POST',
    headers: {
        host: 'drerings.app'
    },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: JSON.stringify({ drawing_id: 'drawing-1' }),
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

describe('US-012 failed-send refund path', () => {
    it('refunds the debited lot when delivery fails after debit', async () => {
        vi.resetModules()

        const debitStamp = vi.fn(async () => ({
            lotId: 'lot-1',
            balanceAfter: 4
        }))
        const refundFailedSend = vi.fn(async () => ({
            lotId: 'lot-1',
            balanceAfter: 5
        }))
        const userOwnsDrawing = vi.fn(async () => true)
        const publishDrawing = vi.fn(async () => {
            throw new Error('Resend hard bounce')
        })
        const consoleError = vi.spyOn(console, 'error')
            .mockImplementation(() => {})

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: async () => activeSession() }
        })
        vi.doMock('../netlify/lib/stamps', () => {
            return {
                debitStamp,
                refundFailedSend,
                InsufficientStampsError: MockInsufficientStampsError
            }
        })
        vi.doMock('../netlify/lib/posts', () => {
            return { publishDrawing, userOwnsDrawing }
        })

        const { handler } = await import('../netlify/functions/posts')
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(500)
        expect(JSON.parse(response.body || '{}')).toEqual({
            error: "Couldn't deliver to that address — your stamp has " +
                'been refunded.'
        })
        expect(refundFailedSend).toHaveBeenCalledWith({
            userId: 'user-1',
            lotId: 'lot-1'
        })
        expect(consoleError).toHaveBeenCalledWith(expect.any(Error))
    })
})

function activeSession () {
    return {
        user: {
            id: 'user-1',
            email: 'paid@example.com',
            subscription_status: 'active'
        }
    }
}

class MockInsufficientStampsError extends Error {
    constructor () {
        super('Insufficient stamps.')
        this.name = 'InsufficientStampsError'
    }
}
