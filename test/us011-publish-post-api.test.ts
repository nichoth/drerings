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

describe('US-011 publish post API', () => {
    it('publishes an owned drawing for an active subscriber', async () => {
        vi.resetModules()

        const publishDrawing = vi.fn(async () => ({ id: 42 }))

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: async () => activeSession() }
        })
        vi.doMock('../netlify/lib/posts', () => {
            return { publishDrawing }
        })

        const { handler } = await import('../netlify/functions/posts')
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({ id: 42 })
        expect(publishDrawing).toHaveBeenCalledWith('user-1', 'drawing-1')
    })

    it('returns the existing post id when the drawing was already published',
        async () => {
            vi.resetModules()

            const publishDrawing = vi.fn(async () => ({ id: 7 }))

            vi.doMock('../netlify/lib/session', () => {
                return { getSession: async () => activeSession() }
            })
            vi.doMock('../netlify/lib/posts', () => {
                return { publishDrawing }
            })

            const { handler } = await import('../netlify/functions/posts')
            const response = await callHandler(handler, baseEvent)

            expect(response.statusCode).toBe(200)
            expect(JSON.parse(response.body || '{}')).toEqual({ id: 7 })
        })

    it('returns unauthorized before publishing', async () => {
        vi.resetModules()

        const publishDrawing = vi.fn()

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: async () => null }
        })
        vi.doMock('../netlify/lib/posts', () => {
            return { publishDrawing }
        })

        const { handler } = await import('../netlify/functions/posts')
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(401)
        expect(publishDrawing).not.toHaveBeenCalled()
    })

    it('returns payment required for free users', async () => {
        vi.resetModules()

        const publishDrawing = vi.fn()

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
        vi.doMock('../netlify/lib/posts', () => {
            return { publishDrawing }
        })

        const { handler } = await import('../netlify/functions/posts')
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(402)
        expect(JSON.parse(response.body || '{}').error).toMatch(/upgrade/i)
        expect(publishDrawing).not.toHaveBeenCalled()
    })

    it('returns forbidden when the drawing is not owned', async () => {
        vi.resetModules()

        const publishDrawing = vi.fn(async () => null)

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: async () => activeSession() }
        })
        vi.doMock('../netlify/lib/posts', () => {
            return { publishDrawing }
        })

        const { handler } = await import('../netlify/functions/posts')
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(403)
        expect(JSON.parse(response.body || '{}').error)
            .toMatch(/cannot publish/i)
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
