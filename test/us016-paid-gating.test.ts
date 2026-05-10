import { describe, expect, it, vi } from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'
import { State } from '../src/state'
import { isPaid } from '../netlify/lib/paid'

const drawingEvent:HandlerEvent = {
    rawUrl: 'https://drerings.app/api/drawings',
    rawQuery: '',
    path: '/api/drawings',
    httpMethod: 'POST',
    headers: {
        host: 'drerings.app'
    },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: JSON.stringify({
        image: 'data:image/png;base64,aW1hZ2U=',
        text: 'A red circle',
        alt_text: 'A hand drawn red circle'
    }),
    isBase64Encoded: false
}

const postEvent:HandlerEvent = {
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

function activeSession () {
    return {
        user: {
            id: 'user-1',
            email: 'paid@example.com',
            subscription_status: 'active' as const
        }
    }
}

describe('US-016 paid feature gating', () => {
    it('has a shared isPaid helper that only accepts active users', () => {
        expect(isPaid({ subscription_status: 'active' })).toBe(true)
        expect(isPaid({ subscription_status: 'free' })).toBe(false)
        expect(isPaid({ subscription_status: 'canceled' })).toBe(false)
        expect(isPaid({ subscription_status: 'past_due' })).toBe(false)
    })

    it('exposes a frontend paid signal derived from the current user', () => {
        const state = State()

        expect(state.isPaid.value).toBe(false)

        state.currentUser.value = {
            id: 'user-1',
            email: 'paid@example.com',
            subscription_status: 'active'
        }
        expect(state.isPaid.value).toBe(true)

        state.currentUser.value = {
            id: 'user-1',
            email: 'paid@example.com',
            subscription_status: 'canceled'
        }
        expect(state.isPaid.value).toBe(false)
    })

    it('uses the paid helper before saving drawings', async () => {
        vi.resetModules()

        const isPaid = vi.fn(() => false)
        const createSavedDrawing = vi.fn(async () => ({
            id: 'drawing-1',
            created_at: '2026-05-10T12:00:00.000Z'
        }))

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: async () => activeSession() }
        })
        vi.doMock('../netlify/lib/paid', () => {
            return { isPaid }
        })
        vi.doMock('../netlify/lib/drawings', () => {
            return { createSavedDrawing }
        })

        const { handler } = await import('../netlify/functions/drawings')
        const response = await callHandler(handler, drawingEvent)

        expect(response.statusCode).toBe(402)
        expect(isPaid).toHaveBeenCalledWith(activeSession().user)
        expect(createSavedDrawing).not.toHaveBeenCalled()
    })

    it('uses the paid helper before publishing drawings', async () => {
        vi.resetModules()

        const isPaid = vi.fn(() => false)
        const publishDrawing = vi.fn(async () => ({ id: 42 }))

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: async () => activeSession() }
        })
        vi.doMock('../netlify/lib/paid', () => {
            return { isPaid }
        })
        vi.doMock('../netlify/lib/posts', () => {
            return { publishDrawing }
        })

        const { handler } = await import('../netlify/functions/posts')
        const response = await callHandler(handler, postEvent)

        expect(response.statusCode).toBe(402)
        expect(isPaid).toHaveBeenCalledWith(activeSession().user)
        expect(publishDrawing).not.toHaveBeenCalled()
    })
})
