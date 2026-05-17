import { h } from 'preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    render,
    screen,
    within
} from '@testing-library/preact'
import { State } from '../src/state'
import { SendRoute } from '../src/routes/send'

describe('US-013 send stamp indicator', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        history.pushState(null, '', '/send/drawing-1')
    })

    it(
        'shows a subtle one-stamp cost indicator by the ' +
        'Send postcard button',
        async () => {
            const state = paidState()

            vi.stubGlobal('fetch', vi.fn(async () => {
                return jsonResponse(savedDrawing())
            }))

            render(h(SendRoute, { state }))

            expect(await screen.findByRole('img', {
                name: 'A hand drawn red circle'
            })).toBeTruthy()

            const postcardActions = screen.getByRole('group', {
                name: 'Send postcard actions'
            })

            expect(within(postcardActions).getByRole('button', {
                name: 'Send postcard'
            })).toBeTruthy()

            const cost = within(postcardActions).getByLabelText(
                'Sending this postcard costs 1 stamp'
            )

            expect(cost.textContent).toContain('1 stamp')
        }
    )

    it(
        'Publish button does NOT show stamp cost indicator',
        async () => {
            const state = paidState()

            vi.stubGlobal('fetch', vi.fn(async () => {
                return jsonResponse(savedDrawing())
            }))

            render(h(SendRoute, { state }))

            await screen.findByRole('img', {
                name: 'A hand drawn red circle'
            })

            const publishActions = screen.getByRole('group', {
                name: 'Publish actions'
            })

            const stampIndicator = within(
                publishActions
            ).queryByText('1 stamp')

            expect(stampIndicator).toBeNull()
        }
    )
})

function paidState ():ReturnType<typeof State> {
    const state = State()

    state.currentUser.value = {
        id: 'user-1',
        email: 'paid@example.com',
        subscription_status: 'active',
        stamps_balance: 3
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
