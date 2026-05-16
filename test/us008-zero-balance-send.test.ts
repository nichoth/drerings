import { h } from 'preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
    Handler,
    HandlerContext,
    HandlerEvent,
    HandlerResponse
} from '@netlify/functions'
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within
} from '@testing-library/preact'
import { State, type AppState } from '../src/state'
import { HomeRoute } from '../src/routes/home'

vi.mock('@substrate-system/atrament', () => {
    return {
        MODE_DRAW: 'draw',
        MODE_ERASE: 'erase',
        default: class MockAtrament {
            color = '#000000'
            weight = 4
            mode = 'draw'
            smoothing = 0
            destroy = vi.fn()

            constructor (
                canvas?:HTMLCanvasElement,
                config:{ width?:number, height?:number } = {}
            ) {
                if (canvas?.tagName === 'CANVAS') {
                    if (config.width) canvas.width = config.width
                    if (config.height) canvas.height = config.height
                }
            }
        }
    }
})

vi.mock('@substrate-system/atrament/fill?worker', () => {
    return { default: {} }
})

describe('US-008 zero-balance send prompt', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        history.pushState(null, '', '/')
        HTMLCanvasElement.prototype.toDataURL = vi.fn(() => {
            return 'data:image/png;base64,Y2FudmFz'
        })
    })

    it('opens buy stamps without losing the current draft', async () => {
        const state = paidState(0)

        state.currentDrawing.value = savedDrawing()
        render(h(HomeRoute, { state }))

        fireEvent.input(screen.getByLabelText('Text'), {
            target: { value: 'A card in progress' }
        })
        fireEvent.input(screen.getByLabelText('Alt text'), {
            target: { value: 'Fresh alt text' }
        })
        fireEvent.click(screen.getByRole('button', { name: 'Send It' }))

        const dialog = await screen.findByRole('dialog', {
            name: 'Buy stamps'
        })

        expect(location.pathname).toBe('/')
        expect(state.route.value).toBe('/')
        expect(within(dialog).getByText('25 stamps')).toBeTruthy()
        expect(textarea('Text').value).toBe('A card in progress')
        expect(textarea('Alt text').value).toBe('Fresh alt text')
    })

    it('allows retrying send after the user balance refreshes', async () => {
        const state = paidState(0)

        state.currentDrawing.value = savedDrawing()
        render(h(HomeRoute, { state }))

        fireEvent.click(screen.getByRole('button', { name: 'Send It' }))
        expect(await screen.findByRole('dialog', { name: 'Buy stamps' }))
            .toBeTruthy()

        state.currentUser.value = {
            ...state.currentUser.value!,
            stamps_balance: 25
        }
        fireEvent.click(screen.getByRole('button', { name: 'Close' }))
        fireEvent.click(screen.getByRole('button', { name: 'Send It' }))

        await waitFor(() => {
            expect(location.pathname).toBe('/send/drawing-1')
        })
        expect(state.route.value).toBe('/send/drawing-1')
    })

    it('stores stamps balance from whoami for later send checks', async () => {
        const state = State()
        const fetcher = vi.fn(async () => {
            return new Response(JSON.stringify({
                id: 'user-1',
                email: 'user@example.com',
                subscription_status: 'active',
                stamps_balance: 4
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            })
        })

        vi.stubGlobal('fetch', fetcher)

        await State.fetchAuthStatus(state)

        expect(state.currentUser.value?.stamps_balance).toBe(4)
    })

    it('returns stamps balance from GET /api/whoami', async () => {
        vi.resetModules()

        const getSession = vi.fn(async () => {
            return {
                user: {
                    id: 'user-1',
                    email: 'user@example.com',
                    subscription_status: 'active',
                    stamps_balance: 4
                }
            }
        })

        vi.doMock('../netlify/lib/session', () => {
            return { getSession }
        })

        const { handler } = await import('../netlify/functions/whoami')
        const response = await callHandler(handler, baseEvent)

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body || '{}')).toEqual({
            id: 'user-1',
            email: 'user@example.com',
            subscription_status: 'active',
            stamps_balance: 4
        })
    })
})

function paidState (stampsBalance:number):AppState {
    const state = State()

    state.currentUser.value = {
        id: 'user-1',
        email: 'buyer@example.com',
        subscription_status: 'active',
        stamps_balance: stampsBalance
    }
    state.auth.value = {
        registered: false,
        authenticated: true
    }

    return state
}

function savedDrawing () {
    return {
        id: 'drawing-1',
        image: 'data:image/png;base64,aW1hZ2U=',
        text: 'A red circle',
        alt_text: 'A hand drawn red circle',
        updated_at: '2026-05-10T12:10:00.000Z'
    }
}

function textarea (name:string):HTMLTextAreaElement {
    return screen.getByLabelText(name) as HTMLTextAreaElement
}

const baseEvent:HandlerEvent = {
    rawUrl: 'https://drerings.app/api/whoami',
    rawQuery: '',
    path: '/api/whoami',
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

async function callHandler (
    handler:Handler,
    event:HandlerEvent
):Promise<HandlerResponse> {
    const response = await handler(event, {} as HandlerContext)

    if (!response) throw new Error('Handler did not return a response')

    return response
}
