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

describe('US-009 drawing read API', () => {
    it('lists the signed-in user saved drawings', async () => {
        vi.resetModules()

        const listSavedDrawings = vi.fn(async () => ([{
            id: 'drawing-1',
            image: 'data:image/png;base64,aW1hZ2U=',
            text: 'A red circle',
            alt_text: 'A hand drawn red circle',
            updated_at: '2026-05-10T12:10:00.000Z'
        }]))

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
                updateSavedDrawing: vi.fn(),
                listSavedDrawings
            }
        })

        const { handler } = await import('../netlify/functions/drawings')
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            drawings: [{
                id: 'drawing-1',
                image: 'data:image/png;base64,aW1hZ2U=',
                text: 'A red circle',
                alt_text: 'A hand drawn red circle',
                updated_at: '2026-05-10T12:10:00.000Z'
            }]
        })
        expect(listSavedDrawings).toHaveBeenCalledWith('user-1')
    })

    it('returns one owned drawing for reopening', async () => {
        vi.resetModules()

        const getSavedDrawing = vi.fn(async () => ({
            id: 'drawing-1',
            image: 'data:image/png;base64,aW1hZ2U=',
            text: 'A red circle',
            alt_text: 'A hand drawn red circle',
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
                updateSavedDrawing: vi.fn(),
                listSavedDrawings: vi.fn(),
                getSavedDrawing
            }
        })

        const { handler } = await import('../netlify/functions/drawings')
        const response = await callHandler(handler, {
            ...baseEvent,
            rawUrl: 'https://drerings.app/api/drawings/drawing-1',
            path: '/api/drawings/drawing-1'
        })

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            id: 'drawing-1',
            image: 'data:image/png;base64,aW1hZ2U=',
            text: 'A red circle',
            alt_text: 'A hand drawn red circle',
            updated_at: '2026-05-10T12:10:00.000Z'
        })
        expect(getSavedDrawing).toHaveBeenCalledWith(
            'user-1',
            'drawing-1'
        )
    })
})
