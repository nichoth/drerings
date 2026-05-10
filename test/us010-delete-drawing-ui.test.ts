import { h } from 'preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/preact'
import { State } from '../src/state'
import { DrawingsRoute } from '../src/routes/drawings'

describe('US-010 delete drawing UI', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('confirms before deleting and removes the drawing from the list',
        async () => {
            const state = paidState()
            const fetcher = vi.fn(async (url:string, init?:RequestInit) => {
                if (init?.method === 'DELETE') {
                    return jsonResponse({ deleted: true })
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
            const confirm = vi.fn(() => true)

            vi.stubGlobal('fetch', fetcher)
            vi.stubGlobal('confirm', confirm)

            render(h(DrawingsRoute, { state }))

            const deleteButton = await screen.findByRole('button', {
                name: 'Delete'
            })
            fireEvent.click(deleteButton)

            await waitFor(() => {
                expect(fetcher).toHaveBeenCalledWith(
                    '/api/drawings/drawing-1',
                    { method: 'DELETE' }
                )
            })
            expect(confirm).toHaveBeenCalledWith(
                'Delete this saved drawing?'
            )
            expect(screen.queryByText('A red circle')).toBe(null)
            expect(screen.getByText(/no saved drawings yet/i)).toBeTruthy()
        })

    it('keeps the drawing when delete is canceled', async () => {
        const state = paidState()
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
        vi.stubGlobal('confirm', vi.fn(() => false))

        render(h(DrawingsRoute, { state }))

        const deleteButton = await screen.findByRole('button', {
            name: 'Delete'
        })
        fireEvent.click(deleteButton)

        expect(screen.getByText('A red circle')).toBeTruthy()
        expect(fetcher).toHaveBeenCalledTimes(1)
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
