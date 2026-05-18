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

describe('US-009 save and load drawing UI', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        HTMLCanvasElement.prototype.toDataURL = vi.fn(() => {
            return 'data:image/png;base64,Y2FudmFz'
        })
    })

    it('saves the current canvas, text, and alt text for paid users',
        async () => {
            const state = paidState()
            const fetcher = vi.fn(async () => {
                return jsonResponse({
                    id: 'drawing-1',
                    created_at: '2026-05-10T12:00:00.000Z'
                })
            })

            vi.stubGlobal('fetch', fetcher)

            render(h(HomeRoute, { state }))
            fireEvent.input(screen.getByLabelText('Text'), {
                target: { value: 'A red circle' }
            })
            fireEvent.input(screen.getByLabelText('Alt text'), {
                target: { value: 'A hand drawn red circle' }
            })
            fireEvent.click(screen.getByRole('button', { name: 'Save' }))

            await waitFor(() => {
                expect(fetcher).toHaveBeenCalledWith('/api/drawings', {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        image: 'data:image/png;base64,Y2FudmFz',
                        text: 'A red circle',
                        alt_text: 'A hand drawn red circle'
                    })
                })
            })
            const status = await screen.findByRole('status', {
                name: 'Drawing save status'
            })

            expect(status.textContent).toMatch(/saved/i)
        })

    it('shows an inline save error when the API rejects the save',
        async () => {
            const state = paidState()

            vi.stubGlobal('fetch', vi.fn(async () => {
                return jsonResponse(
                    { error: 'Unable to save the drawing right now.' },
                    false,
                    500
                )
            }))

            render(h(HomeRoute, { state }))
            fireEvent.click(screen.getByRole('button', { name: 'Save' }))

            const alert = await screen.findByRole('alert')

            expect(alert.textContent).toMatch(/unable to save/i)
        })

    it('lists saved drawings with thumbnails and open actions',
        async () => {
            const state = paidState()

            vi.stubGlobal('fetch', vi.fn(async () => {
                return jsonResponse({
                    drawings: [{
                        id: 'drawing-1',
                        image: 'data:image/png;base64,aW1hZ2U=',
                        text: 'A red circle',
                        alt_text: 'A hand drawn red circle',
                        updated_at: '2026-05-10T12:10:00.000Z'
                    }]
                })
            }))

            render(h(DrawingsRoute, { state }))

            const list = await screen.findByRole('list', {
                name: 'Saved drawings'
            })
            const item = within(list).getByRole('listitem')
            const image = within(item).getByRole('img', {
                name: 'A hand drawn red circle'
            }) as HTMLImageElement

            expect(image.src).toContain('data:image/png;base64,aW1hZ2U=')
            expect(within(item).getByText('A red circle')).toBeTruthy()
            expect(within(item).getByText('2026-05-10T12:10:00.000Z'))
                .toBeTruthy()
            expect(within(item).getByRole('button', { name: 'Open' }))
                .toBeTruthy()
            expect(within(item).getByRole('button', { name: 'Delete' }))
                .toBeTruthy()
        })

    it('loads drawings when auth resolves after the route mounts',
        async () => {
            const state = State()
            const fetcher = vi.fn(async () => {
                return jsonResponse({
                    drawings: [{
                        id: 'drawing-1',
                        image: 'data:image/png;base64,aW1hZ2U=',
                        text: 'A red circle',
                        alt_text: 'A hand drawn red circle',
                        updated_at: '2026-05-10T12:10:00.000Z'
                    }]
                })
            })

            vi.stubGlobal('fetch', fetcher)
            render(h(DrawingsRoute, { state }))

            expect(screen.getByText(/sign in/i)).toBeTruthy()

            state.currentUser.value = {
                id: 'user-1',
                did: 'did:plc:test-1',
                handle: 'paid.bsky.social'
            }

            expect(await screen.findByRole('list', {
                name: 'Saved drawings'
            })).toBeTruthy()
            expect(fetcher).toHaveBeenCalledWith('/api/drawings')
        })

    it('opens a saved drawing back into the composer', async () => {
        const state = paidState()
        const fetcher = vi.fn(async (url:string) => {
            if (url === '/api/drawings/drawing-1') {
                return jsonResponse({
                    id: 'drawing-1',
                    image: 'data:image/png;base64,aW1hZ2U=',
                    text: 'A red circle',
                    alt_text: 'A hand drawn red circle',
                    updated_at: '2026-05-10T12:10:00.000Z'
                })
            }

            return jsonResponse({
                drawings: [{
                    id: 'drawing-1',
                    image: 'data:image/png;base64,aW1hZ2U=',
                    text: 'A red circle',
                    alt_text: 'A hand drawn red circle',
                    updated_at: '2026-05-10T12:10:00.000Z'
                }]
            })
        })

        vi.stubGlobal('fetch', fetcher)
        render(h(DrawingsRoute, { state }))

        const button = await screen.findByRole('button', { name: 'Open' })
        fireEvent.click(button)

        await waitFor(() => {
            expect(state.route.value).toBe('/')
        })

        render(h(HomeRoute, { state }))

        expect((screen.getByLabelText('Text') as HTMLTextAreaElement).value)
            .toBe('A red circle')
        expect((
            screen.getByLabelText('Alt text') as HTMLTextAreaElement
        ).value).toBe('A hand drawn red circle')
    })
})

function paidState ():ReturnType<typeof State> {
    const state = State()

    state.currentUser.value = {
        id: 'user-1',
        did: 'did:plc:test-1',
        handle: 'paid.bsky.social'
    }
    state.auth.value = {
        registered: false,
        authenticated: true
    }

    return state
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
