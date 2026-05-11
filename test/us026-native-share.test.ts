import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/preact'
import {
    State,
    type AppState,
    type PublicPost
} from '../src/state'
import { PostRoute } from '../src/routes/post'

describe('US-026 native share wiring', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        history.pushState(null, '', '/post/42')
        vi.stubGlobal('fetch', vi.fn(async () => {
            return jsonResponse(publicPost())
        }))
    })

    afterEach(() => {
        cleanup()
        vi.unstubAllGlobals()
    })

    it('shares the absolute public post URL when clicked', async () => {
        const canShare = vi.fn(() => true)
        const share = vi.fn(async () => undefined)

        vi.stubGlobal('navigator', {
            canShare,
            share
        })

        render(h(PostRoute, { state: paidState() }))

        const button = await screen.findByRole('button', {
            name: 'Share drawing'
        })
        const url = `${window.location.origin}/post/42`

        expect(share).not.toHaveBeenCalled()

        fireEvent.click(button)

        await waitFor(() => {
            expect(canShare).toHaveBeenCalledWith({ url })
            expect(share).toHaveBeenCalledWith({
                url,
                title: 'A drering for you',
                text: 'Check out this drering:'
            })
        })
    })

    it('opens fallback when native share is unavailable', async () => {
        const fallback = vi.fn()

        vi.stubGlobal('navigator', {})
        window.addEventListener('drerings:share-fallback', fallback)

        render(h(PostRoute, { state: paidState() }))

        const button = await screen.findByRole('button', {
            name: 'Share drawing'
        })
        const url = `${window.location.origin}/post/42`

        fireEvent.click(button)

        await waitFor(() => {
            const event = fallback.mock.calls[0]?.[0] as CustomEvent

            expect(event.detail).toEqual({ url })
        })

        window.removeEventListener('drerings:share-fallback', fallback)
    })

    it('opens the fallback path when the URL cannot be shared', async () => {
        const fallback = vi.fn()
        const share = vi.fn(async () => undefined)

        vi.stubGlobal('navigator', {
            canShare: vi.fn(() => false),
            share
        })
        window.addEventListener('drerings:share-fallback', fallback)

        render(h(PostRoute, { state: paidState() }))

        const button = await screen.findByRole('button', {
            name: 'Share drawing'
        })

        fireEvent.click(button)

        await waitFor(() => {
            expect(fallback).toHaveBeenCalledTimes(1)
            expect(share).not.toHaveBeenCalled()
        })

        window.removeEventListener('drerings:share-fallback', fallback)
    })

    it('swallows native share dismissals without logging', async () => {
        const error = new DOMException('Dismissed', 'AbortError')
        const consoleError = vi.spyOn(console, 'error')
            .mockImplementation(() => {})

        vi.stubGlobal('navigator', {
            canShare: vi.fn(() => true),
            share: vi.fn(async () => {
                throw error
            })
        })

        render(h(PostRoute, { state: paidState() }))

        const button = await screen.findByRole('button', {
            name: 'Share drawing'
        })

        fireEvent.click(button)

        await waitFor(() => {
            expect(button.classList.contains('spinning')).toBe(false)
        })
        expect(consoleError).not.toHaveBeenCalled()
    })

    it('logs unexpected native share errors', async () => {
        const error = new Error('share failed')
        const consoleError = vi.spyOn(console, 'error')
            .mockImplementation(() => {})

        vi.stubGlobal('navigator', {
            canShare: vi.fn(() => true),
            share: vi.fn(async () => {
                throw error
            })
        })

        render(h(PostRoute, { state: paidState() }))

        const button = await screen.findByRole('button', {
            name: 'Share drawing'
        })

        fireEvent.click(button)

        await waitFor(() => {
            expect(consoleError).toHaveBeenCalledWith(
                'Unable to share drawing.',
                error
            )
        })
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

function jsonResponse (body:unknown):Response {
    return {
        ok: true,
        status: 200,
        json: async () => body
    } as Response
}
