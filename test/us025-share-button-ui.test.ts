import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import {
    State,
    type AppState,
    type PublicPost,
    type SavedDrawing
} from '../src/state'
import { PostRoute } from '../src/routes/post'
import { SendRoute } from '../src/routes/send'

describe('US-025 published post share button', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        history.pushState(null, '', '/post/42')
    })

    afterEach(() => {
        cleanup()
    })

    it('renders a real Share button for a paid published post', async () => {
        const state = paidState()

        vi.stubGlobal('fetch', vi.fn(async () => {
            return jsonResponse(publicPost())
        }))

        render(h(PostRoute, { state }))

        await screen.findByRole('img', {
            name: 'A hand drawn red circle'
        })

        const button = screen.getByRole('button', {
            name: 'Share drawing'
        })

        expect(button.tagName).toBe('BUTTON')
        expect(button.classList.contains('btn')).toBe(true)
    })

    it('renders no Share button for a free user', async () => {
        const state = State()

        vi.stubGlobal('fetch', vi.fn(async () => {
            return jsonResponse(publicPost())
        }))

        render(h(PostRoute, { state }))

        await screen.findByRole('img', {
            name: 'A hand drawn red circle'
        })

        expect(screen.queryByRole('button', {
            name: 'Share drawing'
        })).toBeNull()
    })

    it('renders no Share button on the unpublished send view', async () => {
        const state = paidState()

        history.pushState(null, '', '/send/drawing-1')
        vi.stubGlobal('fetch', vi.fn(async () => {
            return jsonResponse(savedDrawing())
        }))

        render(h(SendRoute, { state }))

        await waitFor(() => {
            expect(screen.getByText('A red circle')).toBeTruthy()
        })

        expect(screen.queryByRole('button', {
            name: 'Share drawing'
        })).toBeNull()
    })
})

function paidState ():AppState {
    const state = State()

    state.currentUser.value = {
        id: 'user-1',
        email: 'paid@example.com',
        subscription_status: 'active'
    }

    return state
}

function publicPost ():PublicPost {
    return {
        id: 42,
        image: 'data:image/png;base64,aW1hZ2U=',
        text: 'A red circle',
        alt_text: 'A hand drawn red circle',
        published_at: '2026-05-10T12:20:00.000Z'
    }
}

function savedDrawing ():SavedDrawing {
    return {
        id: 'drawing-1',
        image: 'data:image/png;base64,aW1hZ2U=',
        text: 'A red circle',
        alt_text: 'A hand drawn red circle',
        updated_at: '2026-05-10T12:10:00.000Z'
    }
}

function jsonResponse (body:unknown):Response {
    return {
        ok: true,
        status: 200,
        json: async () => body
    } as Response
}
