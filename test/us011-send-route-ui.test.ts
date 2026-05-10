import { h } from 'preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within
} from '@testing-library/preact'
import { State } from '../src/state'
import { HomeRoute } from '../src/routes/home'
import { DrawingsRoute } from '../src/routes/drawings'
import { SendRoute } from '../src/routes/send'
import Router from '../src/routes/index'

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

describe('US-011 send route UI', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        HTMLCanvasElement.prototype.toDataURL = vi.fn(() => {
            return 'data:image/png;base64,Y2FudmFz'
        })
    })

    it('routes /send/:drawingId to the send confirmation route', () => {
        const state = paidState()
        const router = Router(state)
        const match = router.match('/send/drawing-1')

        expect(match?.params).toEqual({ drawingId: 'drawing-1' })
        expect(match?.action?.(match, '/send/drawing-1')).toBe(SendRoute)
    })

    it('navigates Send It from the home canvas to the current drawing send',
        async () => {
            const state = paidState()

            state.currentDrawing.value = savedDrawing()
            render(h(HomeRoute, { state }))

            fireEvent.click(screen.getByRole('button', { name: 'Send It' }))

            await waitFor(() => {
                expect(location.pathname).toBe('/send/drawing-1')
            })
            expect(state.route.value).toBe('/send/drawing-1')
        })

    it('navigates Send It from a saved drawing list item', async () => {
        const state = paidState()

        vi.stubGlobal('fetch', vi.fn(async () => {
            return jsonResponse({ drawings: [savedDrawing()] })
        }))

        render(h(DrawingsRoute, { state }))

        const list = await screen.findByRole('list', {
            name: 'Saved drawings'
        })
        const item = within(list).getByRole('listitem')

        fireEvent.click(within(item).getByRole('button', {
            name: 'Send It'
        }))

        await waitFor(() => {
            expect(location.pathname).toBe('/send/drawing-1')
        })
        expect(state.route.value).toBe('/send/drawing-1')
    })

    it('loads an owned drawing preview and publishes it', async () => {
        const state = paidState()
        const fetcher = vi.fn(async (url:string, init?:RequestInit) => {
            if (url === '/api/drawings/drawing-1') {
                return jsonResponse(savedDrawing())
            }

            if (url === '/api/posts' && init?.method === 'POST') {
                return jsonResponse({ id: 42 })
            }

            return jsonResponse({ error: 'Not found.' }, false, 404)
        })

        history.pushState(null, '', '/send/drawing-1')
        vi.stubGlobal('fetch', fetcher)

        render(h(SendRoute, { state }))

        expect(await screen.findByRole('img', {
            name: 'A hand drawn red circle'
        })).toBeTruthy()
        expect(screen.getByText('A red circle')).toBeTruthy()

        fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

        await waitFor(() => {
            expect(fetcher).toHaveBeenCalledWith('/api/posts', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({ drawing_id: 'drawing-1' })
            })
        })
        await waitFor(() => {
            expect(location.pathname).toBe('/post/42')
        })
    })
})

function paidState ():ReturnType<typeof State> {
    const state = State()

    state.currentUser.value = {
        id: 'user-1',
        email: 'paid@example.com',
        subscription_status: 'active'
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

function jsonResponse (
    body:unknown,
    ok = true,
    status = 200
):Response {
    return {
        ok,
        status,
        json: async () => body
    } as Response
}
