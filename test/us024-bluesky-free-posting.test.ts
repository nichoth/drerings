import { h } from 'preact'
import { cleanup, render, screen } from '@testing-library/preact'
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'
import {
    State,
    type AppState,
    type CurrentUser,
    type PublicPost
} from '../src/state'
import { PostRoute } from '../src/routes/post'

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

describe('US-024 free broadcast posting', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        history.pushState(null, '', '/post/42')
    })

    afterEach(() => {
        cleanup()
        vi.unstubAllGlobals()
    })

    it('publishes a public post without consuming a stamp', async () => {
        vi.resetModules()

        const debitStamp = vi.fn(async () => {
            throw new Error('Broadcast posts must not debit stamps.')
        })
        const publishDrawing = vi.fn(async () => ({ id: 42 }))
        const userOwnsDrawing = vi.fn(async () => true)

        vi.doMock('../netlify/lib/session', () => {
            return { getSession: async () => activeSession(0) }
        })
        vi.doMock('../netlify/lib/stamps', () => {
            return {
                debitStamp,
                InsufficientStampsError: MockInsufficientStampsError,
                refundFailedSend: vi.fn()
            }
        })
        vi.doMock('../netlify/lib/posts', () => {
            return { publishDrawing, userOwnsDrawing }
        })

        const { handler } = await import('../netlify/functions/posts')
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({ id: 42 })
        expect(debitStamp).not.toHaveBeenCalled()
        expect(publishDrawing).toHaveBeenCalledWith('user-1', 'drawing-1')
    })

    it('keeps the share button available at zero stamp balance',
        async () => {
            const state = paidState(0)

            vi.stubGlobal('fetch', vi.fn(async (url:string|Request) => {
                const urlString = typeof url === 'string' ? url : url.url
                if (urlString === '/api/posts/42') {
                    return jsonResponse(publicPost())
                }
                if (urlString === '/api/shares/precheck') {
                    return jsonResponse({ type: 'free' })
                }
                if (urlString === '/api/shares/confirm') {
                    return jsonResponse({ type: 'free' })
                }
                throw new Error(`Unexpected fetch: ${urlString}`)
            }))

            render(h(PostRoute, { state }))

            await screen.findByRole('img', {
                name: 'A hand drawn red circle'
            })

            const button = screen.getByRole('button', {
                name: 'Share drawing'
            }) as HTMLButtonElement

            expect(button.disabled).toBe(false)
            expect(state.currentUser.value?.stamps_balance).toBe(0)
        })
})

function activeSession (stampsBalance:number):{ user:CurrentUser } {
    return {
        user: {
            id: 'user-1',
            did: 'did:plc:test-1',
            handle: 'paid.bsky.social',
            stamps_balance: stampsBalance
        }
    }
}

function paidState (stampsBalance:number):AppState {
    const state = State()

    state.auth.value = {
        registered: false,
        authenticated: true
    }
    state.currentUser.value = activeSession(stampsBalance).user

    return state
}

function publicPost ():PublicPost {
    return {
        id: 42,
        drawing_id: 'drawing-1',
        image: 'data:image/png;base64,aW1hZ2U=',
        text: 'A red circle',
        alt_text: 'A hand drawn red circle',
        published_at: '2026-05-10T12:20:00.000Z'
    }
}

function jsonResponse (body:unknown):Response {
    return {
        ok: true,
        status: 200,
        json: async () => body
    } as Response
}

class MockInsufficientStampsError extends Error {
    constructor () {
        super('Insufficient stamps.')
        this.name = 'InsufficientStampsError'
    }
}
