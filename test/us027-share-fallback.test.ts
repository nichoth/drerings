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

describe('US-027 share fallback panel', () => {
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

    it('opens fallback actions when native share is unavailable', async () => {
        vi.stubGlobal('navigator', {})

        render(h(PostRoute, { state: paidState() }))

        fireEvent.click(await shareButton())

        expect(await screen.findByRole('button', {
            name: 'Copy link'
        })).toBeTruthy()
        expect(screen.getByRole('button', {
            name: 'Download PNG'
        })).toBeTruthy()
    })

    it('copies the public post URL and shows a confirmation', async () => {
        const writeText = vi.fn(async () => undefined)
        const url = `${window.location.origin}/post/42`

        vi.stubGlobal('navigator', {
            clipboard: { writeText }
        })

        render(h(PostRoute, { state: paidState() }))

        fireEvent.click(await shareButton())
        fireEvent.click(await screen.findByRole('button', {
            name: 'Copy link'
        }))

        await waitFor(() => {
            expect(writeText).toHaveBeenCalledWith(url)
            expect(screen.getByText('Copied')).toBeTruthy()
        })
    })

    it('downloads the drawing image with a stable file name', async () => {
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(() => {})

        vi.stubGlobal('navigator', {})

        render(h(PostRoute, { state: paidState() }))

        fireEvent.click(await shareButton())
        fireEvent.click(await screen.findByRole('button', {
            name: 'Download PNG'
        }))

        await waitFor(() => {
            expect(click).toHaveBeenCalledTimes(1)
        })

        const anchor = click.mock.instances[0] as HTMLAnchorElement

        expect(anchor.download).toBe('drering-42.png')
        expect(anchor.href).toBe(publicPost().image)
    })

    it('shows a selectable URL when clipboard is unavailable', async () => {
        const url = `${window.location.origin}/post/42`

        vi.stubGlobal('navigator', {})

        render(h(PostRoute, { state: paidState() }))

        fireEvent.click(await shareButton())

        const input = await screen.findByDisplayValue(url)

        expect(input.getAttribute('readonly')).toBe('true')
    })

    it('dismisses on Escape and when focus leaves the panel', async () => {
        vi.stubGlobal('navigator', {})

        render(h(PostRoute, { state: paidState() }))

        fireEvent.click(await shareButton())
        expect(await screen.findByRole('button', {
            name: 'Copy link'
        })).toBeTruthy()

        fireEvent.keyDown(document, { key: 'Escape' })
        expect(screen.queryByRole('button', {
            name: 'Copy link'
        })).toBeNull()

        fireEvent.click(await shareButton())

        const panel = await screen.findByRole('group', {
            name: 'Share fallback'
        })

        panel.querySelector('button')?.focus()
        document.body.dispatchEvent(new FocusEvent('focusin', {
            bubbles: true
        }))

        await waitFor(() => {
            expect(screen.queryByRole('button', {
                name: 'Copy link'
            })).toBeNull()
        })
    })

    it('does not render fallback UI for free users', async () => {
        vi.stubGlobal('navigator', {})

        render(h(PostRoute, { state: State() }))

        await screen.findByRole('img', {
            name: 'A hand drawn red circle'
        })

        window.dispatchEvent(new CustomEvent('drerings:share-fallback', {
            detail: {
                url: `${window.location.origin}/post/42`
            }
        }))

        expect(screen.queryByRole('button', {
            name: 'Copy link'
        })).toBeNull()
    })
})

async function shareButton ():Promise<HTMLElement> {
    return await screen.findByRole('button', {
        name: 'Share drawing'
    })
}

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
