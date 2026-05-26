import { describe, expect, it, vi } from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'

const baseEvent:HandlerEvent = {
    rawUrl: 'https://drerings.app/api/posts/42',
    rawQuery: '',
    path: '/api/posts/42',
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

const context = {} as HandlerContext

async function callHandler (
    handler:Handler,
    event:HandlerEvent
):Promise<HandlerResponse> {
    const response = await handler(event, context)

    if (!response) throw new Error('Handler did not return a response')

    return response
}

describe('US-012 public post API', () => {
    it('returns a published post without requiring a session', async () => {
        vi.resetModules()

        const getSession = vi.fn()
        const getPublishedPost = vi.fn(async () => ({
            id: 42,
            image: 'data:image/png;base64,aW1hZ2U=',
            text: 'A red circle',
            alt_text: 'A hand drawn red circle',
            published_at: '2026-05-10T12:20:00.000Z'
        }))

        vi.doMock('../netlify/lib/session', () => {
            return { getSession }
        })
        vi.doMock('../netlify/lib/posts', () => {
            return {
                publishDrawing: vi.fn(),
                getPublishedPost
            }
        })

        const { handler } = await import('../netlify/functions/posts/posts')
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            id: 42,
            image: 'data:image/png;base64,aW1hZ2U=',
            text: 'A red circle',
            alt_text: 'A hand drawn red circle',
            published_at: '2026-05-10T12:20:00.000Z'
        })
        expect(getPublishedPost).toHaveBeenCalledWith(42)
        expect(getSession).not.toHaveBeenCalled()
    })

    it('returns a 404 JSON response for an unknown post id', async () => {
        vi.resetModules()

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: vi.fn() }
        })
        vi.doMock('../netlify/lib/posts', () => {
            return {
                publishDrawing: vi.fn(),
                getPublishedPost: vi.fn(async () => null)
            }
        })

        const { handler } = await import('../netlify/functions/posts/posts')
        const response = await callHandler(handler, {
            ...baseEvent,
            rawUrl: 'https://drerings.app/api/posts/999',
            path: '/api/posts/999'
        })

        expect(response.statusCode).toBe(404)
        expect(JSON.parse(response.body || '{}').error)
            .toMatch(/post not found/i)
    })
})
