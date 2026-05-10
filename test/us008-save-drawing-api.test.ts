import { describe, expect, it, vi } from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'

const baseEvent:HandlerEvent = {
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

function drawingBody ():string {
    return JSON.stringify({
        image: 'data:image/png;base64,aW1hZ2U=',
        text: 'A red circle',
        alt_text: 'A hand drawn red circle'
    })
}

describe('US-008 save drawing API', () => {
    it('requires a session before saving a drawing', async () => {
        vi.resetModules()

        const createSavedDrawing = vi.fn()

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: async () => null }
        })
        vi.doMock('../netlify/lib/drawings', () => {
            return { createSavedDrawing }
        })

        const { handler } = await import('../netlify/functions/drawings')
        const response = await callHandler(handler, {
            ...baseEvent,
            body: drawingBody()
        })

        expect(response.statusCode).toBe(401)
        expect(JSON.parse(response.body || '{}').error)
            .toMatch(/sign in/i)
        expect(createSavedDrawing).not.toHaveBeenCalled()
    })

    it('returns payment required for free users', async () => {
        vi.resetModules()

        const createSavedDrawing = vi.fn()

        vi.doMock('../netlify/lib/session', () => {
            return {
                getSession: async () => ({
                    user: {
                        id: 'user-1',
                        email: 'free@example.com',
                        subscription_status: 'free'
                    }
                })
            }
        })
        vi.doMock('../netlify/lib/drawings', () => {
            return { createSavedDrawing }
        })

        const { handler } = await import('../netlify/functions/drawings')
        const response = await callHandler(handler, {
            ...baseEvent,
            body: drawingBody()
        })

        expect(response.statusCode).toBe(402)
        expect(JSON.parse(response.body || '{}').error)
            .toMatch(/upgrade/i)
        expect(createSavedDrawing).not.toHaveBeenCalled()
    })

    it('saves an active subscriber drawing', async () => {
        vi.resetModules()

        const createSavedDrawing = vi.fn(async () => ({
            id: 'drawing-1',
            created_at: '2026-05-10T12:00:00.000Z'
        }))

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
        vi.doMock('../netlify/lib/drawings', () => {
            return { createSavedDrawing }
        })

        const { handler } = await import('../netlify/functions/drawings')
        const response = await callHandler(handler, {
            ...baseEvent,
            body: drawingBody()
        })

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            id: 'drawing-1',
            created_at: '2026-05-10T12:00:00.000Z'
        })
        expect(createSavedDrawing).toHaveBeenCalledWith('user-1', {
            image: 'data:image/png;base64,aW1hZ2U=',
            text: 'A red circle',
            alt_text: 'A hand drawn red circle'
        })
    })

    it('updates an owned drawing for an active subscriber', async () => {
        vi.resetModules()

        const updateSavedDrawing = vi.fn(async () => ({
            id: 'drawing-1',
            updated_at: '2026-05-10T12:10:00.000Z'
        }))

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
        vi.doMock('../netlify/lib/drawings', () => {
            return {
                createSavedDrawing: vi.fn(),
                updateSavedDrawing
            }
        })

        const { handler } = await import('../netlify/functions/drawings')
        const response = await callHandler(handler, {
            ...baseEvent,
            rawUrl: 'https://drerings.app/api/drawings/drawing-1',
            path: '/api/drawings/drawing-1',
            httpMethod: 'PUT',
            body: drawingBody()
        })

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            id: 'drawing-1',
            updated_at: '2026-05-10T12:10:00.000Z'
        })
        expect(updateSavedDrawing).toHaveBeenCalledWith(
            'user-1',
            'drawing-1',
            {
                image: 'data:image/png;base64,aW1hZ2U=',
                text: 'A red circle',
                alt_text: 'A hand drawn red circle'
            }
        )
    })
})
