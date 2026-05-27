import { describe, expect, it, vi } from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'

const baseEvent:HandlerEvent = {
    rawUrl: 'https://drerings.app/api/drawings/drawing-1',
    rawQuery: '',
    path: '/api/drawings/drawing-1',
    httpMethod: 'DELETE',
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

describe('US-010 delete drawing API', () => {
    it('deletes an owned drawing for an active subscriber', async () => {
        vi.resetModules()

        const deleteSavedDrawing = vi.fn(async () => true)

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: async () => activeSession() }
        })
        vi.doMock('../netlify/lib/drawings', () => {
            return { deleteSavedDrawing }
        })

        const { handler } = await import('../netlify/functions/drawings')
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            deleted: true
        })
        expect(deleteSavedDrawing).toHaveBeenCalledWith(
            'user-1',
            'drawing-1'
        )
    })

    it('returns unauthorized before deleting', async () => {
        vi.resetModules()

        const deleteSavedDrawing = vi.fn()

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: async () => null }
        })
        vi.doMock('../netlify/lib/drawings', () => {
            return { deleteSavedDrawing }
        })

        const { handler } = await import('../netlify/functions/drawings')
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(401)
        expect(deleteSavedDrawing).not.toHaveBeenCalled()
    })

    it('returns forbidden when the drawing is not owned', async () => {
        vi.resetModules()

        const deleteSavedDrawing = vi.fn(async () => false)

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: async () => activeSession() }
        })
        vi.doMock('../netlify/lib/drawings', () => {
            return { deleteSavedDrawing }
        })

        const { handler } = await import('../netlify/functions/drawings')
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(403)
        expect(JSON.parse(response.body || '{}').error)
            .toMatch(/cannot delete/i)
    })
})

function activeSession () {
    return {
        user: {
            id: 'user-1',
            did: 'did:plc:test-1',
            handle: 'test.bsky.social'
        }
    }
}
